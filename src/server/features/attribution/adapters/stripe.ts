import { z } from "zod";
import type { NormalizedEvent } from "../services/attributionIngest";
import { hex, metaText, sameSignature } from "./signature";

const TOLERANCE_SECONDS = 300;
const encoder = new TextEncoder();

/**
 * Checks the `Stripe-Signature` header against the raw body with the endpoint's
 * signing secret: HMAC-SHA256 over `timestamp.body`, within five minutes.
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("=", 2));
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS)
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${timestamp}.${rawBody}`),
    ),
  );
  return signatures.some((s) => sameSignature(s, expected));
}

const id = z.string().min(1).max(200);
const metadata = z.record(z.string(), z.unknown()).optional();

const chargeSchema = z.object({
  id,
  status: z.string(),
  amount: z.number().int(),
  amount_captured: z.number().int().optional(),
  currency: z.string().length(3),
  customer: z.string().nullish(),
  payment_intent: z.string().nullish(),
  created: z.number(),
  livemode: z.boolean(),
  metadata,
});

const refundSchema = z.object({
  id,
  status: z.string().nullish(),
  amount: z.number().int(),
  currency: z.string().length(3),
  charge: z.string().nullish(),
  created: z.number(),
  livemode: z.boolean().optional(),
});

const sessionSchema = z.object({
  id,
  customer: z.string().nullish(),
  payment_intent: z.string().nullish(),
  created: z.number(),
  livemode: z.boolean(),
  metadata,
});

const envelope = z.object({
  id,
  type: z.string(),
  livemode: z.boolean().optional(),
  data: z.object({ object: z.unknown() }),
});

function withMetadataIdentity(
  identifiers: NormalizedEvent["identifiers"],
  m: Record<string, unknown> | undefined,
) {
  const visitor = metaText(m, "cldr_visitor_id");
  const user = metaText(m, "cldr_user_id");
  if (visitor) identifiers.push({ type: "visitor", value: visitor });
  if (user) identifiers.push({ type: "user", value: user });
}

type StripeOutcome =
  | { kind: "event"; event: NormalizedEvent }
  | { kind: "ignored"; reason: string }
  | { kind: "invalid"; reason: string };

/**
 * Turns a Stripe event into a ledger event. Only a successful charge (the
 * payment), a refund, and a completed Checkout Session (to join the visitor id
 * the merchant put in metadata with the Stripe customer) are used. Anything
 * else is ignored, so an invoice and its charge are never counted twice.
 */
export function normalizeStripeEvent(raw: unknown): StripeOutcome {
  const outer = envelope.safeParse(raw);
  if (!outer.success) return { kind: "invalid", reason: "not a Stripe event" };
  const { type, data } = outer.data;

  if (type === "charge.succeeded") {
    const charge = chargeSchema.safeParse(data.object);
    if (!charge.success) return { kind: "invalid", reason: "malformed charge" };
    const c = charge.data;
    if (c.status !== "succeeded")
      return { kind: "ignored", reason: "charge not succeeded" };
    const identifiers: NormalizedEvent["identifiers"] = [];
    if (c.customer) identifiers.push({ type: "customer", value: c.customer });
    if (c.payment_intent)
      identifiers.push({ type: "order", value: c.payment_intent });
    withMetadataIdentity(identifiers, c.metadata);
    return {
      kind: "event",
      event: {
        sourceSystem: "stripe",
        sourceEventId: c.id,
        origin: "webhook",
        eventType: "payment",
        occurredAt: new Date(c.created * 1000).toISOString(),
        identifiers,
        amountMinor: c.amount_captured ?? c.amount,
        currency: c.currency.toUpperCase(),
        isTest: !c.livemode,
      },
    };
  }

  if (type === "refund.created" || type === "refund.updated") {
    const refund = refundSchema.safeParse(data.object);
    if (!refund.success) return { kind: "invalid", reason: "malformed refund" };
    const r = refund.data;
    if (!r.charge)
      return { kind: "ignored", reason: "refund without a charge" };
    if (r.status && !["succeeded", "pending"].includes(r.status))
      return { kind: "ignored", reason: `refund ${r.status}` };
    return {
      kind: "event",
      event: {
        sourceSystem: "stripe",
        sourceEventId: r.id,
        origin: "webhook",
        eventType: "refund",
        occurredAt: new Date(r.created * 1000).toISOString(),
        identifiers: [],
        amountMinor: r.amount,
        currency: r.currency.toUpperCase(),
        parentSourceEventId: r.charge,
        isTest: outer.data.livemode === false,
      },
    };
  }

  if (type === "checkout.session.completed") {
    const session = sessionSchema.safeParse(data.object);
    if (!session.success)
      return { kind: "invalid", reason: "malformed session" };
    const s = session.data;
    const identifiers: NormalizedEvent["identifiers"] = [];
    if (s.customer) identifiers.push({ type: "customer", value: s.customer });
    if (s.payment_intent)
      identifiers.push({ type: "order", value: s.payment_intent });
    withMetadataIdentity(identifiers, s.metadata);
    if (identifiers.length < 2)
      return { kind: "ignored", reason: "nothing to join" };
    return {
      kind: "event",
      event: {
        sourceSystem: "stripe",
        sourceEventId: s.id,
        origin: "webhook",
        eventType: "identify",
        occurredAt: new Date(s.created * 1000).toISOString(),
        identifiers,
        isTest: !s.livemode,
      },
    };
  }

  return { kind: "ignored", reason: type };
}
