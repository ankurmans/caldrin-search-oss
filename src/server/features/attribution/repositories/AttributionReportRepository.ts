import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import {
  attributionConversions,
  attributionCredits,
  attributionEvents,
  attributionIdentityLinks,
  attributionImportBatches,
  attributionRejections,
  attributionTouchpoints,
} from "@/db/schema";

export type ReportScope = {
  projectId: string;
  /** Inclusive ISO start and exclusive ISO end. */
  from: string;
  to: string;
  /** Labelled demo data and real data are never mixed in one report. */
  demo: boolean;
  brandId?: string | null;
};

const IN_CHUNK = 90;
const num = (value: unknown) => Number(value ?? 0);

export function creditFilter(scope: ReportScope) {
  return and(
    eq(attributionCredits.projectId, scope.projectId),
    gte(attributionCredits.occurredAt, scope.from),
    lt(attributionCredits.occurredAt, scope.to),
    eq(attributionConversions.isDemo, scope.demo),
    scope.brandId ? eq(attributionCredits.brandId, scope.brandId) : undefined,
  );
}

/**
 * Credit per model, channel and evidence level, with the revenue it carries.
 * Credit is in basis points, so a conversion counts as `bp / 10000` of itself.
 */
async function creditRollup(
  scope: ReportScope,
  options: { model?: string; bySource?: boolean } = {},
) {
  const source = options.bySource
    ? attributionCredits.source
    : sql<string | null>`null`;
  const rows = await db
    .select({
      model: attributionCredits.modelKey,
      channel: attributionCredits.channel,
      source,
      evidence: attributionCredits.evidence,
      kind: attributionCredits.conversionKind,
      currency: attributionCredits.currency,
      bp: sql<number>`sum(${attributionCredits.creditBp})`,
      weighted: sql<number>`sum(coalesce(${attributionCredits.amountMinor}, 0) * ${attributionCredits.creditBp})`,
    })
    .from(attributionCredits)
    .innerJoin(
      attributionConversions,
      eq(attributionConversions.id, attributionCredits.conversionId),
    )
    .where(
      and(
        creditFilter(scope),
        options.model
          ? eq(attributionCredits.modelKey, options.model)
          : undefined,
      ),
    )
    .groupBy(
      attributionCredits.modelKey,
      attributionCredits.channel,
      ...(options.bySource ? [attributionCredits.source] : []),
      attributionCredits.evidence,
      attributionCredits.conversionKind,
      attributionCredits.currency,
    );
  return rows.map((r) => ({
    ...r,
    bp: num(r.bp),
    weighted: num(r.weighted),
  }));
}

/** Outcomes by kind, and revenue by currency, regardless of model. */
async function conversionTotals(scope: ReportScope) {
  const rows = await db
    .select({
      kind: attributionConversions.kind,
      currency: attributionConversions.currency,
      count: sql<number>`count(*)`,
      first: sql<number>`sum(case when ${attributionConversions.isFirstPayment} then 1 else 0 end)`,
      amount: sql<number>`sum(coalesce(${attributionConversions.amountMinor}, 0))`,
      gross: sql<number>`sum(coalesce(${attributionConversions.grossMinor}, 0))`,
    })
    .from(attributionConversions)
    .where(
      and(
        eq(attributionConversions.projectId, scope.projectId),
        gte(attributionConversions.occurredAt, scope.from),
        lt(attributionConversions.occurredAt, scope.to),
        eq(attributionConversions.isDemo, scope.demo),
        scope.brandId
          ? eq(attributionConversions.brandId, scope.brandId)
          : undefined,
      ),
    )
    .groupBy(attributionConversions.kind, attributionConversions.currency);
  return rows.map((r) => ({
    kind: r.kind,
    currency: r.currency,
    count: num(r.count),
    first: num(r.first),
    amount: num(r.amount),
    gross: num(r.gross),
  }));
}

/** Net revenue and payments per day, per currency. */
async function dailyPayments(scope: ReportScope) {
  const day = sql<string>`substr(${attributionConversions.occurredAt}, 1, 10)`;
  const rows = await db
    .select({
      day,
      currency: attributionConversions.currency,
      count: sql<number>`count(*)`,
      amount: sql<number>`sum(coalesce(${attributionConversions.amountMinor}, 0))`,
    })
    .from(attributionConversions)
    .where(
      and(
        eq(attributionConversions.projectId, scope.projectId),
        eq(attributionConversions.kind, "payment"),
        gte(attributionConversions.occurredAt, scope.from),
        lt(attributionConversions.occurredAt, scope.to),
        eq(attributionConversions.isDemo, scope.demo),
        scope.brandId
          ? eq(attributionConversions.brandId, scope.brandId)
          : undefined,
      ),
    )
    .groupBy(day, attributionConversions.currency)
    .orderBy(day);
  return rows.map((r) => ({
    day: r.day,
    currency: r.currency,
    count: num(r.count),
    amount: num(r.amount),
  }));
}

/** Distinct visitors whose first recorded touch in the window was each channel. */
async function visitorsByChannel(scope: ReportScope) {
  const rows = await db
    .select({
      channel: attributionTouchpoints.channel,
      visitors: sql<number>`count(distinct ${attributionTouchpoints.anchorValue})`,
      sessions: sql<number>`count(*)`,
    })
    .from(attributionTouchpoints)
    .innerJoin(
      attributionEvents,
      eq(attributionEvents.id, attributionTouchpoints.eventId),
    )
    .innerJoin(
      attributionImportBatches,
      eq(attributionImportBatches.id, attributionEvents.importBatchId),
    )
    .where(
      and(
        eq(attributionTouchpoints.projectId, scope.projectId),
        eq(attributionTouchpoints.kind, "session"),
        gte(attributionTouchpoints.occurredAt, scope.from),
        lt(attributionTouchpoints.occurredAt, scope.to),
        eq(attributionImportBatches.isDemo, scope.demo),
        scope.brandId
          ? eq(attributionTouchpoints.brandId, scope.brandId)
          : undefined,
      ),
    )
    .groupBy(attributionTouchpoints.channel);
  return rows.map((r) => ({
    channel: r.channel,
    visitors: num(r.visitors),
    sessions: num(r.sessions),
  }));
}

/** The newest outcomes, newest first, for the journeys list. */
function recentConversions(
  scope: ReportScope,
  options: { kinds?: string[]; limit: number; before?: string },
) {
  return db
    .select()
    .from(attributionConversions)
    .where(
      and(
        eq(attributionConversions.projectId, scope.projectId),
        gte(attributionConversions.occurredAt, scope.from),
        lt(attributionConversions.occurredAt, options.before ?? scope.to),
        eq(attributionConversions.isDemo, scope.demo),
        scope.brandId
          ? eq(attributionConversions.brandId, scope.brandId)
          : undefined,
        options.kinds?.length
          ? inArray(attributionConversions.kind, options.kinds)
          : undefined,
      ),
    )
    .orderBy(desc(attributionConversions.occurredAt))
    .limit(options.limit);
}

async function creditsForConversions(
  projectId: string,
  conversionIds: string[],
  model: string,
) {
  const rows: (typeof attributionCredits.$inferSelect)[] = [];
  for (const part of chunk(conversionIds, IN_CHUNK))
    rows.push(
      ...(await db
        .select()
        .from(attributionCredits)
        .where(
          and(
            eq(attributionCredits.projectId, projectId),
            eq(attributionCredits.modelKey, model),
            inArray(attributionCredits.conversionId, part),
          ),
        )),
    );
  return rows;
}

/** What the ledger holds, by where it came from and how recently. */
async function sourceActivity(projectId: string, since: string) {
  const rows = await db
    .select({
      sourceSystem: attributionEvents.sourceSystem,
      origin: attributionEvents.origin,
      count: sql<number>`count(*)`,
      latest: sql<string>`max(${attributionEvents.ingestedAt})`,
      tests: sql<number>`sum(case when ${attributionEvents.isTest} then 1 else 0 end)`,
      bots: sql<number>`sum(case when ${attributionEvents.isBot} then 1 else 0 end)`,
    })
    .from(attributionEvents)
    .where(
      and(
        eq(attributionEvents.projectId, projectId),
        ne(attributionEvents.sourceSystem, "demo"),
        gte(attributionEvents.ingestedAt, since),
      ),
    )
    .groupBy(attributionEvents.sourceSystem, attributionEvents.origin);
  return rows.map((r) => ({
    ...r,
    count: num(r.count),
    tests: num(r.tests),
    bots: num(r.bots),
  }));
}

/** Of the PostHog sessions held, how many had a source recorded and so became a touch. */
async function posthogCoverage(projectId: string) {
  const [row] = await db
    .select({
      sessions: sql<number>`count(distinct ${attributionEvents.sessionId})`,
      withSource: sql<number>`count(distinct case when ${attributionEvents.eventType} = 'session_start' then ${attributionEvents.sessionId} end)`,
      identifies: sql<number>`sum(case when ${attributionEvents.eventType} = 'identify' then 1 else 0 end)`,
    })
    .from(attributionEvents)
    .where(
      and(
        eq(attributionEvents.projectId, projectId),
        eq(attributionEvents.sourceSystem, "posthog"),
      ),
    );
  return {
    sessions: num(row?.sessions),
    withSource: num(row?.withSource),
    identifies: num(row?.identifies),
  };
}

async function rejectionReasons(projectId: string, since: string) {
  const rows = await db
    .select({
      sourceSystem: attributionRejections.sourceSystem,
      reason: attributionRejections.reason,
      count: sql<number>`count(*)`,
    })
    .from(attributionRejections)
    .where(
      and(
        eq(attributionRejections.projectId, projectId),
        gte(attributionRejections.createdAt, since),
      ),
    )
    .groupBy(attributionRejections.sourceSystem, attributionRejections.reason);
  return rows.map((r) => ({ ...r, count: num(r.count) }));
}

async function conflictCount(projectId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(attributionIdentityLinks)
    .where(
      and(
        eq(attributionIdentityLinks.projectId, projectId),
        eq(attributionIdentityLinks.status, "conflict"),
      ),
    );
  return num(row?.count);
}

/** Outcomes whose events were never matched to a recorded source, by kind. */
async function unattributedShare(scope: ReportScope, model: string) {
  const rows = await db
    .select({
      kind: attributionCredits.conversionKind,
      currency: attributionCredits.currency,
      unknown: sql<number>`sum(case when ${attributionCredits.channel} = 'unknown' then ${attributionCredits.creditBp} else 0 end)`,
      total: sql<number>`sum(${attributionCredits.creditBp})`,
    })
    .from(attributionCredits)
    .innerJoin(
      attributionConversions,
      eq(attributionConversions.id, attributionCredits.conversionId),
    )
    .where(and(creditFilter(scope), eq(attributionCredits.modelKey, model)))
    .groupBy(attributionCredits.conversionKind, attributionCredits.currency);
  return rows.map((r) => ({
    kind: r.kind,
    currency: r.currency,
    unknown: num(r.unknown),
    total: num(r.total),
  }));
}

async function batches(projectId: string, demo: boolean, limit: number) {
  return db
    .select()
    .from(attributionImportBatches)
    .where(
      and(
        eq(attributionImportBatches.projectId, projectId),
        eq(attributionImportBatches.isDemo, demo),
      ),
    )
    .orderBy(desc(attributionImportBatches.createdAt))
    .limit(limit);
}

async function hasDemoBatch(projectId: string) {
  const [row] = await db
    .select({ id: attributionImportBatches.id })
    .from(attributionImportBatches)
    .where(
      and(
        eq(attributionImportBatches.projectId, projectId),
        eq(attributionImportBatches.isDemo, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export const AttributionReportRepository = {
  creditRollup,
  conversionTotals,
  dailyPayments,
  visitorsByChannel,
  recentConversions,
  creditsForConversions,
  sourceActivity,
  posthogCoverage,
  rejectionReasons,
  conflictCount,
  unattributedShare,
  batches,
  hasDemoBatch,
};
