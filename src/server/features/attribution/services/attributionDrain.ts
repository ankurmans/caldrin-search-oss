import { classifySource, type SourceRule } from "@/shared/attribution/channels";
import { classifySelfReported } from "@/shared/attribution/selfReported";
import {
  CHANNELS,
  IDENTIFIER_TYPES,
  isConversionType,
  narrow,
  type IdentifierType,
} from "@/shared/attribution/vocabulary";
import { sha256Hex } from "@/server/lib/audit/ids";
import {
  AttributionLedgerRepository as ledger,
  type EventRow,
} from "../repositories/AttributionLedgerRepository";
import { AttributionResultsRepository as results } from "../repositories/AttributionResultsRepository";
import {
  ensureModelRun,
  recomputeConversion,
  type CreditContext,
} from "./attributionCredit";
import { resolveIdentity } from "./attributionIdentity";

const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 90;

type DrainContext = CreditContext & {
  ownHosts: string[];
  demoBatches: Set<string>;
  rules: SourceRule[];
};

const shortId = async (...parts: string[]) =>
  (await sha256Hex(parts.join("|"))).slice(0, 36);

async function loadContext(projectId: string): Promise<DrainContext> {
  const [settings, properties, rules, demoBatches] = await Promise.all([
    ledger.getSettings(projectId),
    ledger.listProperties(projectId),
    ledger.listSourceRules(projectId),
    ledger.demoBatchIds(projectId),
  ]);
  const lookbackDays = settings?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  return {
    projectId,
    lookbackDays,
    runId: await ensureModelRun(projectId, lookbackDays, "settings_change"),
    ownHosts: properties.map((p) => p.host),
    demoBatches,
    rules: rules.flatMap((r) =>
      r.matchKind === "referrer_host" ||
      r.matchKind === "utm_source" ||
      r.matchKind === "utm_medium" ||
      r.matchKind === "click_id"
        ? [
            {
              id: r.id,
              matchKind: r.matchKind,
              pattern: r.pattern,
              channel: narrow(CHANNELS, r.channel) ?? "unknown",
              sourceLabel: r.sourceLabel,
            },
          ]
        : [],
    ),
  };
}

/** Subjects whose conversions need their credits worked out again. */
async function recompute(
  ctx: DrainContext,
  subjectIds: string[],
  after?: string,
) {
  if (!subjectIds.length) return;
  const conversions = await results.conversionsOfSubjects(
    ctx.projectId,
    subjectIds,
  );
  for (const conversion of conversions) {
    if (after && conversion.occurredAt < after) continue;
    if (
      after &&
      Date.parse(conversion.occurredAt) - Date.parse(after) >
        ctx.lookbackDays * DAY_MS
    )
      continue;
    await recomputeConversion(ctx, conversion);
  }
}

const hasSourceEvidence = (e: EventRow) =>
  Boolean(e.referrerHost || e.utmSource || e.utmMedium || e.clickIdKind);

async function deriveEvent(
  ctx: DrainContext,
  event: EventRow,
  identifiers: { type: IdentifierType; value: string }[],
) {
  // Test and bot traffic stays in the ledger, where the health view counts it.
  if (event.isTest || event.isBot || event.eventType === "page_view") return;

  const identity = await resolveIdentity(
    ctx.projectId,
    event.id,
    event.occurredAt,
    identifiers,
  );
  for (const m of identity.merged) {
    await results.reassignConversions(ctx.projectId, m.from, m.to);
  }
  const touchSubjects = new Set<string>();

  const visitor = identifiers.find((i) => i.type === "visitor");
  const anchor = visitor ?? identifiers[0];
  const anchorType = anchor?.type ?? "event";
  const anchorValue = anchor?.value ?? event.id;

  // A session the tracker recorded, or the source an outcome carried itself.
  // An outcome that names a visitor is covered by that visitor's own session.
  const ownsSource =
    event.eventType === "session_start" ||
    (!visitor && isConversionType(event.eventType) && hasSourceEvidence(event));
  if (ownsSource) {
    const cls = classifySource(
      {
        referrerHost: event.referrerHost,
        utmSource: event.utmSource,
        utmMedium: event.utmMedium,
        clickIdKind: event.clickIdKind,
        ownHosts: ctx.ownHosts,
      },
      ctx.rules,
    );
    await results.upsertTouchpoint({
      id: await shortId("tp", event.id),
      projectId: ctx.projectId,
      eventId: event.id,
      kind: "session",
      anchorType,
      anchorValue,
      sessionId: event.sessionId,
      propertyId: event.propertyId,
      brandId: event.brandId,
      occurredAt: event.occurredAt,
      channel: cls.channel,
      source: cls.source,
      ruleId: cls.ruleId,
      landingHost: event.landingHost,
      landingPath: event.landingPath,
      referrerHost: event.referrerHost,
      utmCampaign: event.utmCampaign,
    });
    touchSubjects.add(identity.subjectId);
  }
  if (event.selfReportedSource) {
    const cls = classifySelfReported(event.selfReportedSource);
    await results.upsertTouchpoint({
      id: await shortId("tp-self", event.id),
      projectId: ctx.projectId,
      eventId: event.id,
      kind: "self_reported",
      anchorType: identifiers[0]?.type ?? "event",
      anchorValue: identifiers[0]?.value ?? event.id,
      propertyId: event.propertyId,
      brandId: event.brandId,
      occurredAt: event.occurredAt,
      channel: cls.channel,
      source: cls.source,
      ruleId: "builtin:self_reported",
      selfReportedText: event.selfReportedSource,
    });
    touchSubjects.add(identity.subjectId);
  }

  if (isConversionType(event.eventType)) {
    const gross = event.amountMinor;
    const refunded =
      event.eventType === "payment" && gross != null
        ? await results.refundedFor(ctx.projectId, event.sourceEventId)
        : 0;
    const row = {
      id: await shortId("conv", event.id),
      projectId: ctx.projectId,
      eventId: event.id,
      kind: event.eventType,
      subjectId: identity.subjectId,
      occurredAt: event.occurredAt,
      brandId: event.brandId,
      propertyId: event.propertyId,
      isDemo:
        event.importBatchId != null && ctx.demoBatches.has(event.importBatchId),
      grossMinor: gross,
      amountMinor: gross == null ? null : gross - refunded,
      currency: event.currency,
      isFirstPayment:
        event.eventType === "payment" &&
        !(await results.hasEarlierPayment(
          ctx.projectId,
          identity.subjectId,
          event.occurredAt,
          event.id,
        )),
    };
    await results.upsertConversion(row);
    const stored = await results.getConversionByEvent(event.id);
    if (stored) await recomputeConversion(ctx, stored);
  }

  if (event.eventType === "refund" && event.parentSourceEventId) {
    const payment = await results.paymentBySourceId(
      ctx.projectId,
      event.parentSourceEventId,
    );
    const conversion =
      payment && (await results.getConversionByEvent(payment.id));
    if (conversion && conversion.grossMinor != null) {
      const refunded = await results.refundedFor(
        ctx.projectId,
        event.parentSourceEventId,
      );
      await results.upsertConversion({
        ...conversion,
        amountMinor: conversion.grossMinor - refunded,
      });
      const updated = await results.getConversionByEvent(payment.id);
      if (updated) await recomputeConversion(ctx, updated);
    }
  }

  // A touchpoint that arrives after the outcome, or an identity that just
  // merged, changes the credit of conversions already derived.
  await recompute(ctx, [...new Set(identity.merged.map((m) => m.to))]);
  if (touchSubjects.size)
    await recompute(ctx, [...touchSubjects], event.occurredAt);
}

/**
 * Works the queue of events that still need touchpoints, conversions and
 * credits, oldest first. Stops after `budget` events so a request or a cron
 * tick stays inside its limits; what is left stays queued.
 */
export async function drainAttribution(projectId: string, budget = 100) {
  const queue = await ledger.listPending(projectId, budget);
  if (queue.length === 0) return { processed: 0, remaining: 0 };
  const ctx = await loadContext(projectId);
  const events = await ledger.getEvents(queue.map((q) => q.eventId));
  const byId = new Map(events.map((e) => [e.id, e]));
  const identifiers = new Map<
    string,
    { type: IdentifierType; value: string }[]
  >();
  for (const row of await ledger.identifiersOf(queue.map((q) => q.eventId))) {
    const list = identifiers.get(row.eventId) ?? [];
    const type = narrow(IDENTIFIER_TYPES, row.identifierType);
    if (type) list.push({ type, value: row.value });
    identifiers.set(row.eventId, list);
  }
  for (const item of queue) {
    const event = byId.get(item.eventId);
    if (event) await deriveEvent(ctx, event, identifiers.get(event.id) ?? []);
  }
  await ledger.clearPending(queue.map((q) => q.eventId));
  return {
    processed: queue.length,
    remaining: await ledger.countPending(projectId),
  };
}
