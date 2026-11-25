import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestServerEvents } from "./attributionApiIngest";
import { ingestNormalized } from "./attributionIngest";
import { getConversionEvidence } from "./attributionEvidence";
import { getAttributionHealth } from "./attributionHealth";
import { seedAttributionDemo, removeAttributionDemo } from "./attributionDemo";
import {
  compareAttributionModels,
  getAttributionOverview,
  listJourneys,
} from "./attributionReports";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../../ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const real = { projectId: "project", range: "28d", demo: false } as const;

beforeEach(async () => {
  await testDb.seedProject();
});

async function sendJourney() {
  await ingestServerEvents("project", [
    {
      event_id: "su",
      type: "signup",
      user_id: "u1",
      url: "https://example.com/?utm_source=newsletter&utm_medium=email",
      occurred_at: iso(5),
    },
    {
      event_id: "pay",
      type: "payment",
      user_id: "u1",
      customer_id: "c1",
      amount_minor: 4900,
      currency: "USD",
      occurred_at: iso(3),
    },
    {
      event_id: "orphan",
      type: "payment",
      customer_id: "c2",
      amount_minor: 1000,
      currency: "USD",
      occurred_at: iso(3),
    },
  ]);
}

describe("revenue attribution reports", () => {
  it("shows revenue by channel with unknown kept apart, and lists what no source was recorded for", async () => {
    await sendJourney();

    const overview = await getAttributionOverview({
      ...real,
      model: "last_touch",
    });

    const email = overview.channels.find((c) => c.channel === "email");
    const unknown = overview.channels.find((c) => c.channel === "unknown");
    // The signup carried its own source and the same user id as the payment.
    expect(email?.revenue).toEqual([{ currency: "USD", minor: 4900 }]);
    expect(email?.evidenceBp.observed).toBeGreaterThan(0);
    expect(unknown?.revenue).toEqual([{ currency: "USD", minor: 1000 }]);
    expect(overview.unknownBp).toBeGreaterThan(0);
    expect(
      overview.outcomes.find((o) => o.kind === "payment")?.revenue,
    ).toEqual([{ currency: "USD", minor: 5900 }]);
  });

  it("explains a conversion from the event to each model's credit, with the rule that classified the source", async () => {
    await sendJourney();
    // A recorded visit, joined to the buyer only by a signup that carried both ids.
    await ingestNormalized(
      "project",
      { sourceSystem: "tracker", label: "Tracker snippet" },
      [
        {
          sourceSystem: "tracker",
          sourceEventId: "visit",
          origin: "browser",
          eventType: "session_start",
          occurredAt: iso(9),
          identifiers: [{ type: "visitor", value: "v9" }],
          referrerHost: "chatgpt.com",
          landingHost: "example.com",
          landingPath: "/guide",
        },
        {
          sourceSystem: "server_api",
          sourceEventId: "su9",
          origin: "server",
          eventType: "signup",
          occurredAt: iso(8),
          identifiers: [
            { type: "visitor", value: "v9" },
            { type: "user", value: "u9" },
          ],
        },
        {
          sourceSystem: "server_api",
          sourceEventId: "pay9",
          origin: "server",
          eventType: "payment",
          occurredAt: iso(7),
          identifiers: [{ type: "user", value: "u9" }],
          amountMinor: 2500,
          currency: "USD",
        },
      ],
    );
    const { items } = await listJourneys({ ...real, kinds: ["payment"] });
    const linked = items.find((i) => i.amountMinor === 2500);

    const evidence = await getConversionEvidence("project", linked!.id);

    expect(evidence?.event?.sourceEventId).toBe("pay9");
    expect(evidence?.touchpoints).toContainEqual(
      expect.objectContaining({
        channel: "ai_referral",
        source: "ChatGPT",
        sharedId: false,
      }),
    );
    expect(evidence?.touchpoints[0]?.ruleId).toBeTruthy();
    expect(evidence?.links.map((l) => l.status)).toContain("active");
    expect(
      evidence?.models.find((m) => m.model === "last_touch")?.credits[0],
    ).toMatchObject({ channel: "ai_referral", bp: 10000, evidence: "linked" });

    const orphan = items.find((i) => i.amountMinor === 1000);
    expect(
      (await getConversionEvidence("project", orphan!.id))?.notes[0],
    ).toMatch(/stays unknown/);
  });

  it("never mixes demo data into a real report, and removing it leaves real data as it was", async () => {
    await sendJourney();
    const before = await getAttributionOverview(real);

    await seedAttributionDemo("project");
    const demo = await getAttributionOverview({ ...real, demo: true });
    const realWithDemo = await getAttributionOverview(real);

    expect(demo.demoAvailable).toBe(true);
    expect(
      demo.outcomes.find((o) => o.kind === "payment")?.count,
    ).toBeGreaterThan(10);
    expect(realWithDemo.channels).toEqual(before.channels);
    expect(
      (await getAttributionHealth("project", false)).sources.some(
        (s) => s.sourceSystem === "demo",
      ),
    ).toBe(false);

    await removeAttributionDemo("project");

    const after = await getAttributionOverview({ ...real, demo: true });
    expect(after.demoAvailable).toBe(false);
    expect(after.outcomes.every((o) => o.count === 0)).toBe(true);
    expect((await getAttributionOverview(real)).channels).toEqual(
      before.channels,
    );
  });

  it("compares every model on the same outcomes", async () => {
    await sendJourney();

    const table = await compareAttributionModels({ ...real, kind: "payment" });

    const email = table.rows.find((r) => r.channel === "email");
    expect(email?.cells).toHaveLength(7);
    expect(email?.cells.find((c) => c.model === "first_touch")?.minor).toBe(
      4900,
    );
  });
});
