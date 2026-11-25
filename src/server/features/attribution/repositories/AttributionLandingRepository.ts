import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attributionConversions,
  attributionCredits,
  attributionEvents,
  attributionImportBatches,
  attributionTouchpoints,
} from "@/db/schema";
import { creditFilter, type ReportScope } from "./AttributionReportRepository";

const num = (value: unknown) => Number(value ?? 0);

type PageFilter = { host?: string; path?: string };

const pageCondition = (filter: PageFilter) =>
  and(
    filter.host
      ? eq(attributionTouchpoints.landingHost, filter.host)
      : undefined,
    filter.path
      ? eq(attributionTouchpoints.landingPath, filter.path)
      : undefined,
  );

/**
 * Credit a model gave to sessions that landed on each page, by evidence and
 * outcome kind. Only a credit that points at a session touchpoint has a
 * landing page; self-reported and call credits have none and are left out.
 */
async function creditsByLandingPage(
  scope: ReportScope,
  model: string,
  options: { channel?: string } & PageFilter = {},
) {
  const rows = await db
    .select({
      host: attributionTouchpoints.landingHost,
      path: attributionTouchpoints.landingPath,
      channel: attributionCredits.channel,
      evidence: attributionCredits.evidence,
      kind: attributionCredits.conversionKind,
      currency: attributionCredits.currency,
      conversions: sql<number>`count(distinct ${attributionCredits.conversionId})`,
      bp: sql<number>`sum(${attributionCredits.creditBp})`,
      weighted: sql<number>`sum(coalesce(${attributionCredits.amountMinor}, 0) * ${attributionCredits.creditBp})`,
    })
    .from(attributionCredits)
    .innerJoin(
      attributionConversions,
      eq(attributionConversions.id, attributionCredits.conversionId),
    )
    .innerJoin(
      attributionTouchpoints,
      eq(attributionTouchpoints.id, attributionCredits.touchpointId),
    )
    .where(
      and(
        creditFilter(scope),
        eq(attributionCredits.modelKey, model),
        eq(attributionTouchpoints.kind, "session"),
        options.channel
          ? eq(attributionCredits.channel, options.channel)
          : undefined,
        pageCondition(options),
      ),
    )
    .groupBy(
      attributionTouchpoints.landingHost,
      attributionTouchpoints.landingPath,
      attributionCredits.channel,
      attributionCredits.evidence,
      attributionCredits.conversionKind,
      attributionCredits.currency,
    );
  return rows.flatMap((r) =>
    r.host && r.path
      ? [
          {
            host: r.host,
            path: r.path,
            channel: r.channel,
            evidence: r.evidence,
            kind: r.kind,
            currency: r.currency,
            conversions: num(r.conversions),
            bp: num(r.bp),
            weighted: num(r.weighted),
          },
        ]
      : [],
  );
}

/** Sessions and distinct visitors that landed on each page, by channel. */
async function sessionsByLandingPage(
  scope: ReportScope,
  options: { channel?: string } & PageFilter = {},
) {
  const rows = await db
    .select({
      host: attributionTouchpoints.landingHost,
      path: attributionTouchpoints.landingPath,
      channel: attributionTouchpoints.channel,
      source: attributionTouchpoints.source,
      sessions: sql<number>`count(*)`,
      visitors: sql<number>`count(distinct ${attributionTouchpoints.anchorValue})`,
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
        options.channel
          ? eq(attributionTouchpoints.channel, options.channel)
          : undefined,
        pageCondition(options),
      ),
    )
    .groupBy(
      attributionTouchpoints.landingHost,
      attributionTouchpoints.landingPath,
      attributionTouchpoints.channel,
      attributionTouchpoints.source,
    );
  return rows.flatMap((r) =>
    r.host && r.path
      ? [
          {
            host: r.host,
            path: r.path,
            channel: r.channel,
            source: r.source,
            sessions: num(r.sessions),
            visitors: num(r.visitors),
          },
        ]
      : [],
  );
}

/** What buyers said in their own words, grouped by the channel it was read as. */
async function selfReportedBySource(scope: ReportScope, channel: string) {
  const rows = await db
    .select({
      source: attributionTouchpoints.source,
      count: sql<number>`count(*)`,
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
        eq(attributionTouchpoints.kind, "self_reported"),
        eq(attributionTouchpoints.channel, channel),
        gte(attributionTouchpoints.occurredAt, scope.from),
        lt(attributionTouchpoints.occurredAt, scope.to),
        eq(attributionImportBatches.isDemo, scope.demo),
      ),
    )
    .groupBy(attributionTouchpoints.source);
  return rows.map((r) => ({ source: r.source, count: num(r.count) }));
}

export const AttributionLandingRepository = {
  creditsByLandingPage,
  sessionsByLandingPage,
  selfReportedBySource,
};
