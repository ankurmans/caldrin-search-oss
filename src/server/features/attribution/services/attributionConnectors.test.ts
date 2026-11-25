import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPolarConnector,
  createStripeConnector,
  handlePolarDelivery,
  handleStripeDelivery,
  listAttributionConnectors,
} from "./attributionConnectors";
import { importAttributionCsv } from "./attributionImport";
import { getAttributionOverview } from "./attributionReports";

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
const encoder = new TextEncoder();

async function sign(
  body: string,
  secret = SECRET,
  t = Math.floor(Date.now() / 1000),
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
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
  return `t=${t},v1=${hex}`;
}

const charge = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: `evt_${id}`,
    type: "charge.succeeded",
    livemode: true,
    data: {
      object: {
        id,
        status: "succeeded",
        amount: 4900,
        currency: "usd",
        customer: "cus_1",
        payment_intent: `pi_${id}`,
        created: Math.floor(Date.now() / 1000) - 3600,
        livemode: true,
        ...extra,
      },
    },
  });

let connectorId: string;
beforeEach(async () => {
  await testDb.seedProject();
  connectorId = (
    await createStripeConnector("project", {
      label: "Main account",
      signingSecret: SECRET,
    })
  ).id;
});

describe("Stripe webhook", () => {
  it("counts a signed charge once however often it is delivered, and nets a refund against it", async () => {
    const body = charge("ch_1");
    const signature = await sign(body);

    const first = await handleStripeDelivery(connectorId, body, signature);
    const again = await handleStripeDelivery(connectorId, body, signature);
    const refund = JSON.stringify({
      id: "evt_r",
      type: "refund.created",
      data: {
        object: {
          id: "re_1",
          status: "succeeded",
          amount: 1000,
          currency: "usd",
          charge: "ch_1",
          created: Math.floor(Date.now() / 1000) - 60,
        },
      },
    });
    await handleStripeDelivery(connectorId, refund, await sign(refund));

    expect(first.body).toMatchObject({ accepted: 1 });
    expect(again.body).toMatchObject({ accepted: 0, duplicate: 1 });
    const overview = await getAttributionOverview({
      projectId: "project",
      range: "28d",
      demo: false,
    });
    expect(overview.outcomes.find((o) => o.kind === "payment")).toMatchObject({
      count: 1,
      revenue: [{ currency: "USD", minor: 3900 }],
      refunded: [{ currency: "USD", minor: 1000 }],
    });
  });

  it("refuses a body that was not signed with the connector's secret and records the failure", async () => {
    const body = charge("ch_2");

    const wrong = await handleStripeDelivery(
      connectorId,
      body,
      await sign(body, "whsec_someoneelse123456"),
    );
    const stale = await handleStripeDelivery(
      connectorId,
      body,
      await sign(body, SECRET, Math.floor(Date.now() / 1000) - 3600),
    );

    expect(wrong.status).toBe(400);
    expect(stale.status).toBe(400);
    const [connector] = await listAttributionConnectors("project");
    expect(connector).toMatchObject({
      failedCount: 2,
      lastFailure: "bad signature",
    });
    expect(connector).not.toHaveProperty("sealedSecret");
    const rows = await testDb.client.execute(
      "SELECT count(*) AS n FROM attribution_events",
    );
    expect(Number(rows.rows[0]?.n)).toBe(0);
  });

  it("treats a test-mode charge as a test event that never reaches a report", async () => {
    const body = charge("ch_3", { livemode: false });

    await handleStripeDelivery(connectorId, body, await sign(body));

    const overview = await getAttributionOverview({
      projectId: "project",
      range: "28d",
      demo: false,
    });
    expect(overview.outcomes.find((o) => o.kind === "payment")?.count).toBe(0);
  });
});

const POLAR_SECRET = `whsec_${btoa("polar-test-secret-bytes")}`;

/** Standard Webhooks headers; `asText` signs with the secret's own text, as older Polar secrets do. */
async function polarHeaders(body: string, secret: string, asText = false) {
  const id = "msg_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const keyBytes = asText
    ? encoder.encode(secret)
    : Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) =>
        c.charCodeAt(0),
      );
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${id}.${timestamp}.${body}`),
  );
  return {
    id,
    timestamp,
    signature: `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`,
  };
}

const polarOrder = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "order.paid",
    data: {
      id: "ord_1",
      paid: true,
      net_amount: 4900,
      total_amount: 5300,
      currency: "usd",
      created_at: new Date(Date.now() - 3_600_000).toISOString(),
      customer_id: "cus_1",
      metadata: { cldr_visitor_id: "v_1" },
      ...extra,
    },
  });

describe("Polar webhook", () => {
  let polarId: string;
  beforeEach(async () => {
    polarId = (
      await createPolarConnector("project", {
        label: "Polar org",
        signingSecret: POLAR_SECRET,
      })
    ).id;
  });

  it("counts a signed order before tax once, nets a refund against it, and accepts a secret that signs with its own text", async () => {
    const body = polarOrder();
    const headers = await polarHeaders(body, POLAR_SECRET);

    const first = await handlePolarDelivery(polarId, body, headers);
    const again = await handlePolarDelivery(polarId, body, headers);
    const refund = JSON.stringify({
      type: "refund.created",
      data: {
        id: "ref_1",
        status: "succeeded",
        amount: 1060,
        tax_amount: 60,
        currency: "usd",
        created_at: new Date().toISOString(),
        order_id: "ord_1",
      },
    });
    await handlePolarDelivery(
      polarId,
      refund,
      await polarHeaders(refund, POLAR_SECRET, true),
    );

    expect(first.body).toMatchObject({ accepted: 1 });
    expect(again.body).toMatchObject({ accepted: 0, duplicate: 1 });
    const overview = await getAttributionOverview({
      projectId: "project",
      range: "28d",
      demo: false,
    });
    expect(overview.outcomes.find((o) => o.kind === "payment")).toMatchObject({
      count: 1,
      revenue: [{ currency: "USD", minor: 3900 }],
      refunded: [{ currency: "USD", minor: 1000 }],
    });
  });

  it("leaves out another product's order and the refund of an order it never counted", async () => {
    const mine = "11111111-aaaa-bbbb-cccc-000000000001";
    const other = polarOrder({
      id: "ord_other",
      product_id: "someone-elses-product",
    });
    const refund = JSON.stringify({
      type: "refund.created",
      data: {
        id: "ref_other",
        status: "succeeded",
        amount: 500,
        tax_amount: 0,
        currency: "usd",
        created_at: new Date().toISOString(),
        order_id: "ord_other",
      },
    });

    const order = await handlePolarDelivery(
      polarId,
      other,
      await polarHeaders(other, POLAR_SECRET),
      [mine],
    );
    const refunded = await handlePolarDelivery(
      polarId,
      refund,
      await polarHeaders(refund, POLAR_SECRET),
      [mine],
    );

    expect(order.body).toEqual({ ignored: "other product" });
    expect(refunded.body).toEqual({ ignored: "other product" });
    const rows = await testDb.client.execute(
      "SELECT count(*) AS n FROM attribution_events",
    );
    expect(Number(rows.rows[0]?.n)).toBe(0);
  });

  it("refuses a body signed with another secret", async () => {
    const body = polarOrder({ id: "ord_2" });

    const result = await handlePolarDelivery(
      polarId,
      body,
      await polarHeaders(body, `whsec_${btoa("someone-else-entirely")}`),
    );

    expect(result.status).toBe(400);
  });
});

describe("CSV import", () => {
  it("previews without writing, imports valid rows, and skips them when the same file comes again", async () => {
    const text = [
      "date,event_type,id,amount,currency,customer_id,source",
      `${new Date().toISOString().slice(0, 10)},payment,inv-1,25.00,USD,c9,A podcast`,
      `${new Date().toISOString().slice(0, 10)},payment,inv-2,not-money,USD,c9,`,
    ].join("\n");

    const preview = await importAttributionCsv("project", {
      text,
      label: "November",
      dryRun: true,
    });
    const first = await importAttributionCsv("project", {
      text,
      label: "November",
      dryRun: false,
    });
    const second = await importAttributionCsv("project", {
      text,
      label: "November",
      dryRun: false,
    });

    expect(preview).toMatchObject({ valid: 1, imported: null });
    expect(preview.errors.map((e) => e.row)).toEqual([3]);
    expect(first.imported).toMatchObject({ accepted: 1, duplicate: 0 });
    expect(second.imported).toMatchObject({ accepted: 0, duplicate: 1 });
    const overview = await getAttributionOverview({
      projectId: "project",
      range: "28d",
      demo: false,
      model: "self_reported",
    });
    // A self-reported "podcast" is a real answer, carried at self-reported evidence.
    expect(
      overview.channels.find((c) => c.evidenceBp.self_reported > 0),
    ).toBeTruthy();
  });
});
