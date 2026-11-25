import type { Channel } from "@/shared/attribution/vocabulary";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { drainAttribution } from "./attributionDrain";
import { ingestNormalized, type NormalizedEvent } from "./attributionIngest";
import { reprocessAttribution } from "./attributionReprocess";

const DAY_MS = 86_400_000;
const CUSTOMERS = 90;

// A small seeded generator, so the same demo is built every time.
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHANNEL_WEIGHTS: [Channel, number][] = [
  ["organic_search", 30],
  ["ai_referral", 14],
  ["paid", 14],
  ["social", 9],
  ["email", 9],
  ["referral", 7],
  ["direct", 17],
];

const SOURCE_FIELDS: Record<string, Partial<NormalizedEvent>> = {
  organic_search: { referrerHost: "www.google.com" },
  ai_referral: { referrerHost: "chatgpt.com" },
  paid: { utmSource: "google", utmMedium: "cpc", utmCampaign: "brand-search" },
  social: { referrerHost: "www.linkedin.com" },
  email: { utmSource: "newsletter", utmMedium: "email" },
  referral: { referrerHost: "partner.example" },
  direct: {},
};

const PRICES = [4900, 9900, 19900];
const LANDING = ["/pricing", "/guides/getting-started", "/compare", "/"];

/**
 * Builds a labelled, self-contained example: visits from several channels,
 * signups, payments, a few refunds and some payments with no recorded source.
 * Every id is prefixed `demo-`, the batch is flagged as demo, and no report
 * shows it unless demo data is asked for.
 */
function buildDemoEvents(now: number): NormalizedEvent[] {
  const rand = random(20261122);
  const pick = <T>(items: [T, number][]) => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [item, weight] of items) {
      r -= weight;
      if (r <= 0) return item;
    }
    return items[0][0];
  };
  const at = (daysAgo: number) =>
    new Date(now - daysAgo * DAY_MS).toISOString();
  const events: NormalizedEvent[] = [];
  const base = { sourceSystem: "demo" as const, isTest: false };

  for (let i = 0; i < CUSTOMERS; i++) {
    const visitor = `demo-v-${i}`;
    const user = `demo-u-${i}`;
    const customer = `demo-c-${i}`;
    const start = 4 + Math.floor(rand() * 80);
    const sessions = 1 + Math.floor(rand() * 3);
    for (let s = 0; s < sessions; s++) {
      const channel = pick(CHANNEL_WEIGHTS);
      const day = Math.max(start - s * (1 + Math.floor(rand() * 5)), 2);
      events.push({
        ...base,
        sourceEventId: `demo-s-${i}-${s}`,
        origin: "browser",
        eventType: "session_start",
        occurredAt: at(day),
        identifiers: [{ type: "visitor", value: visitor }],
        sessionId: `demo-sess-${i}-${s}`,
        landingHost: "demo.example",
        landingPath: LANDING[Math.floor(rand() * LANDING.length)],
        ...SOURCE_FIELDS[channel],
      });
    }
    if (rand() > 0.7) continue;
    const signupDay = Math.max(start - sessions * 3, 1.5);
    events.push({
      ...base,
      sourceEventId: `demo-signup-${i}`,
      origin: "server",
      eventType: "signup",
      occurredAt: at(signupDay),
      identifiers: [
        { type: "visitor", value: visitor },
        { type: "user", value: user },
      ],
    });
    if (rand() > 0.5) continue;
    const price = PRICES[Math.floor(rand() * PRICES.length)] ?? 4900;
    const paidDay = Math.max(signupDay - 1, 1);
    events.push({
      ...base,
      sourceEventId: `demo-pay-${i}`,
      origin: "webhook",
      eventType: "payment",
      occurredAt: at(paidDay),
      identifiers: [
        { type: "user", value: user },
        { type: "customer", value: customer },
      ],
      amountMinor: price,
      currency: "USD",
    });
    if (rand() < 0.1)
      events.push({
        ...base,
        sourceEventId: `demo-refund-${i}`,
        origin: "webhook",
        eventType: "refund",
        occurredAt: at(Math.max(paidDay - 0.5, 0.5)),
        identifiers: [],
        amountMinor: price,
        currency: "USD",
        parentSourceEventId: `demo-pay-${i}`,
      });
  }
  // Payments the billing system reported with nothing that ties them to a visit.
  for (let i = 0; i < 12; i++)
    events.push({
      ...base,
      sourceEventId: `demo-orphan-${i}`,
      origin: "webhook",
      eventType: "payment",
      occurredAt: at(2 + rand() * 60),
      identifiers: [{ type: "customer", value: `demo-oc-${i}` }],
      amountMinor: PRICES[i % PRICES.length],
      currency: "USD",
    });
  return events;
}

const DRAIN_ROUNDS = 40;

export async function seedAttributionDemo(projectId: string) {
  if ((await ledger.demoBatchIds(projectId)).size > 0)
    return { created: false, events: 0 };
  const events = buildDemoEvents(Date.now());
  const result = await ingestNormalized(
    projectId,
    { sourceSystem: "demo", label: "Demo data", isDemo: true },
    events,
  );
  for (let i = 0; i < DRAIN_ROUNDS; i++)
    if ((await drainAttribution(projectId, 200)).remaining === 0) break;
  return { created: true, events: result.accepted };
}

export async function removeAttributionDemo(
  projectId: string,
  userId?: string,
) {
  const removed = await ledger.deleteDemoData(projectId);
  if (removed > 0)
    await reprocessAttribution(projectId, {
      reason: "demo_removed",
      userId,
      budget: 200,
    });
  return { removed };
}
