import { z } from "zod";
import type { NormalizedEvent } from "../services/attributionIngest";
import { metaText, sameSignature } from "./signature";

const TOLERANCE_SECONDS = 300;
const encoder = new TextEncoder();

function base64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** The two keys Polar has signed with: the decoded secret, or the secret text itself. */
function signingKeys(secret: string) {
  const keys = [encoder.encode(secret)];
  try {
    const raw = atob(secret.replace(/^whsec_/, ""));
    keys.push(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
  } catch {
    // Not base64, so only the text form can apply.
  }
  return keys;
}

/**
 * Checks Polar's Standard Webhooks headers against the raw body: HMAC-SHA256
 * over `id.timestamp.body`, within five minutes. Secrets made before
 * 2026-09-08 sign with the secret's own text and newer ones with its decoded
 * bytes, so either key is accepted.
 */
export async function verifyPolarSignature(
  rawBody: string,
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS)
    return false;
  const given = signature
    .split(" ")
    .flatMap((part) => (part.startsWith("v1,") ? [part.slice(3)] : []));
  if (given.length === 0) return false;
  for (const raw of signingKeys(secret.trim())) {
    const key = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = base64(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(`${id}.${timestamp}.${rawBody}`),
      ),
    );
    if (given.some((s) => sameSignature(s, expected))) return true;
  }
  return false;
}

const id = z.string().min(1).max(200);
const metadata = z.record(z.string(), z.unknown()).optional();

const orderSchema = z.object({
  id,
  paid: z.boolean(),
  net_amount: z.number().int(),
  currency: z.string().length(3),
  created_at: z.string(),
  customer_id: z.string().nullish(),
  product_id: z.string().nullish(),
  metadata,
  customer: z.object({ external_id: z.string().nullish() }).nullish(),
});

const refundSchema = z.object({
  id,
  status: z.string(),
  amount: z.number().int(),
  tax_amount: z.number().int(),
  currency: z.string().length(3),
  created_at: z.string(),
  order_id: z.string().min(1).max(200),
});

const envelope = z.object({ type: z.string(), data: z.unknown() });

type PolarOutcome =
  | { kind: "event"; event: NormalizedEvent }
  | { kind: "ignored"; reason: string }
  | { kind: "invalid"; reason: string };

const isoTime = (value: string) => {
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

/**
 * Turns a Polar event into a ledger event. Only a paid order (the payment) and
 * a refund are used, both counted net of tax. A refund joins its order by id.
 * Polar sends no test-mode flag, so a sandbox endpoint must not be connected.
 * An organization can sell several products, so `products` limits orders to
 * those product ids; a refund carries no product and is filtered by its order.
 */
export function normalizePolarEvent(
  raw: unknown,
  products: string[] = [],
): PolarOutcome {
  const outer = envelope.safeParse(raw);
  if (!outer.success) return { kind: "invalid", reason: "not a Polar event" };
  const { type, data } = outer.data;

  if (type === "order.paid") {
    const parsed = orderSchema.safeParse(data);
    if (!parsed.success) return { kind: "invalid", reason: "malformed order" };
    const o = parsed.data;
    const occurredAt = isoTime(o.created_at);
    if (!occurredAt) return { kind: "invalid", reason: "malformed order" };
    if (!o.paid || o.net_amount <= 0)
      return { kind: "ignored", reason: "no payment in this order" };
    if (products.length && !products.includes(o.product_id ?? ""))
      return { kind: "ignored", reason: "other product" };
    const identifiers: NormalizedEvent["identifiers"] = [
      { type: "order", value: o.id },
    ];
    if (o.customer_id)
      identifiers.push({ type: "customer", value: o.customer_id });
    const visitor = metaText(o.metadata, "cldr_visitor_id");
    const user =
      metaText(o.metadata, "cldr_user_id") ?? o.customer?.external_id ?? null;
    if (visitor) identifiers.push({ type: "visitor", value: visitor });
    if (user && user.length <= 200)
      identifiers.push({ type: "user", value: user });
    return {
      kind: "event",
      event: {
        sourceSystem: "polar",
        sourceEventId: o.id,
        origin: "webhook",
        eventType: "payment",
        occurredAt,
        identifiers,
        amountMinor: o.net_amount,
        currency: o.currency.toUpperCase(),
      },
    };
  }

  if (type === "refund.created" || type === "refund.updated") {
    const parsed = refundSchema.safeParse(data);
    if (!parsed.success) return { kind: "invalid", reason: "malformed refund" };
    const r = parsed.data;
    const occurredAt = isoTime(r.created_at);
    if (!occurredAt) return { kind: "invalid", reason: "malformed refund" };
    if (!["pending", "succeeded"].includes(r.status))
      return { kind: "ignored", reason: `refund ${r.status}` };
    return {
      kind: "event",
      event: {
        sourceSystem: "polar",
        sourceEventId: r.id,
        origin: "webhook",
        eventType: "refund",
        occurredAt,
        identifiers: [],
        amountMinor: Math.max(r.amount - r.tax_amount, 0),
        currency: r.currency.toUpperCase(),
        parentSourceEventId: r.order_id,
      },
    };
  }

  return { kind: "ignored", reason: type };
}
