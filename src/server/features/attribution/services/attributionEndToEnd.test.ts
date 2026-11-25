import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ingestBrowserEvents,
  ingestServerEvents,
} from "./attributionApiIngest";
import {
  createStripeConnector,
  handleStripeDelivery,
} from "./attributionConnectors";
import { getAttributionOverview, listJourneys } from "./attributionReports";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../../ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1", BETTER_AUTH_SECRET: "test-secret" },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

const SECRET = `whsec_${btoa("synthetic-test-secret-key-1")}`;
const HOUR = 3_600_000;
const encoder = new TextEncoder();

async function deliver(connectorId: string, object: unknown, type: string) {
  const body = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    type,
    livemode: true,
    data: { object },
  });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${t}.${body}`),
  );
  const hex = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return handleStripeDelivery(connectorId, body, `t=${t},v1=${hex}`);
}

const secondsAgo = (hours: number) =>
  Math.floor((Date.now() - hours * HOUR) / 1000);
const charge = (
  id: string,
  hours: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  status: "succeeded",
  amount: 1900,
  currency: "usd",
  customer: "cus_main",
  payment_intent: `pi_${id}`,
  created: secondsAgo(hours),
  livemode: true,
  ...extra,
});

beforeEach(async () => {
  await testDb.seedProject();
});

const channel = (
  o: Awaited<ReturnType<typeof getAttributionOverview>>,
  name: string,
) => o.channels.find((c) => c.channel === name);

describe("a subscription product, from first visit to renewal", () => {
  it("credits the paid first touch, joins Stripe to the visitor through checkout metadata, nets a refund and leaves a stranger's charge unknown", async () => {
    await ledger.insertProperty({
      id: "prop",
      projectId: "project",
      name: "Site",
      host: "app.example.com",
      createdAt: new Date().toISOString(),
    });
    const { id: connectorId } = await createStripeConnector("project", {
      label: "Stripe",
      signingSecret: SECRET,
    });

    // Day 1: an ad click. Day 3: back from a search result. Both are one visitor.
    await ingestBrowserEvents("project", {
      userAgent: "Mozilla/5.0",
      doNotTrack: false,
      events: [
        {
          id: "s1",
          type: "session_start",
          t: Date.now() - 70 * HOUR,
          vid: "v1",
          sid: "a",
          url: "https://app.example.com/?utm_source=google&utm_medium=cpc",
        },
        {
          id: "s2",
          type: "session_start",
          t: Date.now() - 40 * HOUR,
          vid: "v1",
          sid: "b",
          url: "https://app.example.com/pricing",
          ref: "https://www.google.com/",
        },
      ],
    });
    // The backend reports the signup with the visitor id it read from the cookie.
    await ingestServerEvents("project", [
      {
        event_id: "signup-1",
        type: "signup",
        visitor_id: "v1",
        user_id: "u1",
        occurred_at: new Date(Date.now() - 30 * HOUR).toISOString(),
      },
    ]);
    // Checkout carries the visitor id in metadata, which is what joins the Stripe customer to it.
    await deliver(
      connectorId,
      {
        id: "cs_1",
        customer: "cus_main",
        payment_intent: "pi_first",
        created: secondsAgo(20),
        livemode: true,
        metadata: { cldr_visitor_id: "v1", cldr_user_id: "u1" },
      },
      "checkout.session.completed",
    );
    await deliver(connectorId, charge("ch_first", 20), "charge.succeeded");
    // A renewal a month on, carrying nothing but the customer id.
    await deliver(connectorId, charge("ch_renewal", 2), "charge.succeeded");
    await deliver(
      connectorId,
      {
        id: "re_1",
        status: "succeeded",
        amount: 1900,
        currency: "usd",
        charge: "ch_first",
        created: secondsAgo(1),
      },
      "refund.created",
    );
    // A charge from a customer nobody has seen on the site.
    await deliver(
      connectorId,
      charge("ch_stranger", 5, { customer: "cus_stranger", amount: 5000 }),
      "charge.succeeded",
    );

    const range = { projectId: "project", range: "28d", demo: false } as const;
    const first = await getAttributionOverview({
      ...range,
      model: "first_touch",
    });
    const last = await getAttributionOverview({
      ...range,
      model: "last_non_direct",
    });

    // Net of the refund: 1900 + 1900 - 1900 from the customer, 5000 from the stranger.
    expect(first.outcomes.find((o) => o.kind === "payment")).toMatchObject({
      count: 3,
      firstPayments: 2,
      revenue: [{ currency: "USD", minor: 6900 }],
    });
    // First touch: the ad. Last non-direct: the search result. Both are linked, not observed.
    expect(channel(first, "paid")?.revenue).toEqual([
      { currency: "USD", minor: 1900 },
    ]);
    expect(channel(first, "paid")?.evidenceBp.linked).toBeGreaterThan(0);
    expect(channel(last, "organic_search")?.revenue).toEqual([
      { currency: "USD", minor: 1900 },
    ]);
    // The stranger stays unknown under both models, and so does nothing else.
    expect(channel(first, "unknown")?.revenue).toEqual([
      { currency: "USD", minor: 5000 },
    ]);
    expect(channel(last, "unknown")?.revenue).toEqual([
      { currency: "USD", minor: 5000 },
    ]);
    expect(first.unknownBp).toBeGreaterThan(0);
    // The renewal is not a first payment.
    const { items } = await listJourneys({ ...range, kinds: ["payment"] });
    expect(items.filter((i) => i.isFirstPayment)).toHaveLength(2);
  });
});
