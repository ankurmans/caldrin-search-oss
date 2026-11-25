import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ingestBrowserEvents,
  ingestServerEvents,
} from "./attributionApiIngest";
import { drainAttribution } from "./attributionDrain";
import { getAttributionOverview } from "./attributionReports";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../../ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

const HOST = "example.com";
const HOUR = 3_600_000;
const query = { projectId: "project", range: "28d", demo: false } as const;

const visit = (n: number) => ({
  id: `v-${n}`,
  type: "session_start" as const,
  t: Date.now() - 60 * HOUR,
  vid: `vis-${n}`,
  sid: `ses-${n}`,
  url: `https://${HOST}/?utm_medium=cpc&utm_source=g`,
});
const signup = (n: number) => ({
  event_id: `su-${n}`,
  type: "signup" as const,
  visitor_id: `vis-${n}`,
  user_id: `u-${n}`,
  occurred_at: new Date(Date.now() - 50 * HOUR).toISOString(),
});
const payment = (n: number) => ({
  event_id: `pay-${n}`,
  type: "payment" as const,
  user_id: `u-${n}`,
  customer_id: `c-${n}`,
  amount_minor: 1000,
  currency: "USD",
  occurred_at: new Date(Date.now() - 40 * HOUR).toISOString(),
});
const sendVisits = (events: ReturnType<typeof visit>[]) =>
  ingestBrowserEvents("project", {
    events,
    userAgent: "Mozilla/5.0",
    doNotTrack: false,
  });

async function paidRevenue() {
  const o = await getAttributionOverview(query);
  return o.channels.find((c) => c.channel === "paid")?.revenue ?? [];
}

beforeEach(async () => {
  await testDb.seedProject();
  await ledger.insertProperty({
    id: "prop",
    projectId: "project",
    name: "Site",
    host: HOST,
    createdAt: new Date().toISOString(),
  });
});

describe("events that arrive out of order", () => {
  it("credits a payment to the visit that reached the database after it, as if they had arrived in order", async () => {
    await ingestServerEvents("project", [payment(1)]);
    expect(await paidRevenue()).toEqual([]);

    await ingestServerEvents("project", [signup(1)]);
    await sendVisits([visit(1)]);

    expect(await paidRevenue()).toEqual([{ currency: "USD", minor: 1000 }]);
  });
});

describe("a large backlog", () => {
  it("is credited in budgeted drains, and nothing is lost or counted twice along the way", async () => {
    const visitors = Array.from({ length: 120 }, (_, i) => i);
    for (let i = 0; i < visitors.length; i += 20)
      await sendVisits(visitors.slice(i, i + 20).map(visit));
    await ingestServerEvents("project", visitors.map(signup));
    await ingestServerEvents("project", visitors.slice(0, 100).map(payment));
    await ingestServerEvents("project", visitors.slice(100).map(payment));

    let remaining = 1;
    for (let pass = 0; pass < 20 && remaining > 0; pass++)
      remaining = (await drainAttribution("project", 50)).remaining;

    expect(remaining).toBe(0);
    expect(await paidRevenue()).toEqual([{ currency: "USD", minor: 120_000 }]);
  }, 30_000);
});
