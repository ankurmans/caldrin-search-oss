import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  ingestBrowserEvents,
  ingestServerEvents,
} from "./attributionApiIngest";
import {
  authenticateAttributionKey,
  rotateAttributionKey,
} from "./attributionKeys";
import { reprocessAttribution } from "./attributionReprocess";
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
// Days before now, so browser clocks and server timestamps stay consistent.
const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const browser = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  type: "session_start" as const,
  t: Date.now() - 2 * 3_600_000,
  vid: "v1",
  sid: "s1",
  url: `https://${HOST}/pricing`,
  ...over,
});
const send = (events: ReturnType<typeof browser>[], projectId = "project") =>
  ingestBrowserEvents(projectId, {
    events,
    userAgent: "Mozilla/5.0",
    doNotTrack: false,
  });

/** Credits per channel for one model, in basis points, on the project's payment. */
async function paymentCredits(model: string, projectId = "project") {
  const rows = await testDb.client.execute({
    sql: `SELECT channel, credit_bp, evidence, amount_minor FROM attribution_credits
          WHERE project_id = ? AND model_key = ? AND conversion_kind = 'payment' ORDER BY channel`,
    args: [projectId, model],
  });
  return rows.rows.map((r) => ({
    channel: r.channel,
    bp: Number(r.credit_bp),
    evidence: r.evidence,
    amount: Number(r.amount_minor),
  }));
}

describe("revenue attribution ledger", () => {
  beforeEach(async () => {
    await testDb.seedProject();
    await testDb.client.executeMultiple(`
      INSERT INTO projects (id, organization_id, name, domain)
        VALUES ('other', 'organization', 'Other', 'other.test');
    `);
    for (const projectId of ["project", "other"])
      await ledger.insertProperty({
        id: `prop-${projectId}`,
        projectId,
        name: "Site",
        host: projectId === "project" ? HOST : "other.test",
        createdAt: iso(30),
      });
  });

  it("follows a visit to a signup to a payment, credits the recorded source, and keeps unknown outcomes unknown", async () => {
    await send([
      browser({
        id: "e1",
        vid: "v1",
        url: `https://${HOST}/guide?utm_source=newsletter&utm_medium=email`,
        t: Date.now() - 60 * 3_600_000,
      }),
      browser({
        id: "e2",
        vid: "v1",
        sid: "s2",
        url: `https://${HOST}/pricing`,
        ref: "https://www.google.com/search?q=secret",
        t: Date.now() - 50 * 3_600_000,
      }),
    ]);
    await ingestServerEvents("project", [
      {
        event_id: "su1",
        type: "signup",
        visitor_id: "v1",
        user_id: "u1",
        occurred_at: iso(2),
      },
      {
        event_id: "pay1",
        type: "payment",
        customer_id: "c1",
        user_id: "u1",
        amount_minor: 4900,
        currency: "USD",
        occurred_at: iso(1),
      },
      // a payment with a billing customer and nothing else: observed, source unknown
      {
        event_id: "pay2",
        type: "payment",
        customer_id: "c2",
        amount_minor: 1000,
        currency: "USD",
        occurred_at: iso(1),
      },
    ]);

    const first = await paymentCredits("first_touch");
    expect(first).toContainEqual({
      channel: "email",
      bp: 10000,
      evidence: "linked",
      amount: 4900,
    });
    const last = await paymentCredits("last_non_direct");
    expect(last).toContainEqual({
      channel: "organic_search",
      bp: 10000,
      evidence: "linked",
      amount: 4900,
    });
    expect(await paymentCredits("linear")).toEqual(
      expect.arrayContaining([
        { channel: "email", bp: 5000, evidence: "modelled", amount: 4900 },
        {
          channel: "organic_search",
          bp: 5000,
          evidence: "modelled",
          amount: 4900,
        },
      ]),
    );
    // the unlinked payment keeps its unknown source under every model
    expect(first).toContainEqual({
      channel: "unknown",
      bp: 10000,
      evidence: "unknown",
      amount: 1000,
    });
    expect(await paymentCredits("last_touch")).toContainEqual({
      channel: "unknown",
      bp: 10000,
      evidence: "unknown",
      amount: 1000,
    });
  });

  it("stores a repeated delivery once", async () => {
    const event = {
      event_id: "dup",
      type: "signup" as const,
      user_id: "u1",
      occurred_at: iso(2),
    };
    await ingestServerEvents("project", [event]);
    const again = await ingestServerEvents("project", [event]);

    expect(again).toMatchObject({ accepted: 0, duplicate: 1 });
    const count = await testDb.client.execute(
      "SELECT count(*) AS n FROM attribution_events WHERE source_event_id = 'dup'",
    );
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  it("nets a refund off the payment and the credit", async () => {
    await ingestServerEvents("project", [
      {
        event_id: "pay",
        type: "payment",
        user_id: "u1",
        amount_minor: 5000,
        currency: "USD",
        occurred_at: iso(2),
      },
      {
        event_id: "ref",
        type: "refund",
        user_id: "u1",
        amount_minor: 2000,
        currency: "USD",
        parent_event_id: "pay",
        occurred_at: iso(1),
      },
    ]);

    expect(await paymentCredits("last_touch")).toEqual([
      { channel: "unknown", bp: 10000, evidence: "unknown", amount: 3000 },
    ]);
  });

  it("refuses to put two different users in one subject", async () => {
    await ingestServerEvents("project", [
      {
        event_id: "a",
        type: "signup",
        visitor_id: "shared",
        user_id: "u1",
        occurred_at: iso(2),
      },
      {
        event_id: "b",
        type: "signup",
        visitor_id: "shared",
        user_id: "u2",
        occurred_at: iso(1),
      },
    ]);

    const links = await testDb.client.execute(
      "SELECT status FROM attribution_identity_links WHERE project_id = 'project' ORDER BY status",
    );
    expect(links.rows.map((r) => r.status)).toEqual(["active", "conflict"]);
    const subjects = await testDb.client.execute(
      "SELECT count(DISTINCT subject_id) AS n FROM attribution_identity_nodes WHERE node_type = 'user'",
    );
    expect(Number(subjects.rows[0]?.n)).toBe(2);
  });

  it("never joins identities across projects", async () => {
    await send([browser({ id: "p1", vid: "same", url: `https://${HOST}/` })]);
    await ingestServerEvents("other", [
      {
        event_id: "o1",
        type: "signup",
        visitor_id: "same",
        user_id: "u1",
        occurred_at: iso(2),
      },
    ]);

    const credit = await testDb.client.execute(
      "SELECT channel FROM attribution_credits WHERE project_id = 'other' AND model_key = 'first_touch'",
    );
    expect(credit.rows.map((r) => r.channel)).toEqual(["unknown"]);
  });

  it("rebuilds the same credits from the ledger without changing an event", async () => {
    await send([
      browser({
        id: "r1",
        vid: "v9",
        t: Date.now() - 60 * 3_600_000,
        url: `https://${HOST}/?utm_medium=cpc&utm_source=g`,
      }),
    ]);
    await ingestServerEvents("project", [
      {
        event_id: "s9",
        type: "signup",
        visitor_id: "v9",
        user_id: "u9",
        occurred_at: iso(2),
      },
      {
        event_id: "p9",
        type: "payment",
        user_id: "u9",
        customer_id: "c9",
        amount_minor: 900,
        currency: "USD",
        occurred_at: iso(1),
      },
    ]);
    const before = await paymentCredits("first_touch");
    expect(before).toContainEqual(expect.objectContaining({ channel: "paid" }));
    const events = await testDb.client.execute(
      "SELECT id, occurred_at, ingested_at FROM attribution_events ORDER BY id",
    );

    await reprocessAttribution("project", { reason: "test", budget: 500 });

    expect(await paymentCredits("first_touch")).toEqual(before);
    expect(
      (
        await testDb.client.execute(
          "SELECT id, occurred_at, ingested_at FROM attribution_events ORDER BY id",
        )
      ).rows,
    ).toEqual(events.rows);
  });

  it("takes no identity or outcome from the public browser key", async () => {
    const result = await send([
      browser({ id: "page", type: "page_view" as const }),
      browser({ id: "fake", type: "signup" }),
    ]);

    expect(result).toMatchObject({
      accepted: 1,
      rejections: [{ reason: "secret_key_required" }],
    });
  });

  it("drops browser events from unregistered hosts and from visitors who ask not to be tracked", async () => {
    const stray = await send([browser({ url: "https://elsewhere.test/" })]);
    const dnt = await ingestBrowserEvents("project", {
      events: [browser({})],
      userAgent: "x",
      doNotTrack: true,
    });

    expect(stray).toMatchObject({
      accepted: 0,
      rejections: [{ reason: "unregistered_host" }],
    });
    expect(dnt).toMatchObject({
      accepted: 0,
      rejections: [{ reason: "do_not_track" }],
    });
  });

  it("accepts only keys of the right kind, and a rotated key stops working", async () => {
    const { key: secret } = await rotateAttributionKey("project", "secret");
    const { key: pub } = await rotateAttributionKey("project", "public");

    expect(await authenticateAttributionKey(secret, "secret")).toMatchObject({
      projectId: "project",
    });
    expect(await authenticateAttributionKey(pub, "secret")).toBeNull();
    await rotateAttributionKey("project", "secret");
    expect(await authenticateAttributionKey(secret, "secret")).toBeNull();
  });
});

void db;
