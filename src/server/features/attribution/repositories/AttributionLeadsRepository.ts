import { and, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import {
  attributionConversions,
  attributionEventIdentifiers,
  attributionEvents,
  attributionIdentityNodes,
  attributionImportBatches,
} from "@/db/schema";
import type { ReportScope } from "./AttributionReportRepository";

const IN_CHUNK = 90;
const MAX_EVENTS = 20_000;

/** Outcomes that make up the enquiry-to-cash pipeline. */
const PIPELINE_TYPES = [
  "lead",
  "qualified_lead",
  "call",
  "booking",
  "deal_won",
  "deal_lost",
  "payment",
];

/**
 * Pipeline events in the period, as the source recorded them. Test and bot
 * events are left out; demo and real data are never mixed.
 */
async function pipelineEvents(scope: ReportScope) {
  return db
    .select({
      id: attributionEvents.id,
      eventType: attributionEvents.eventType,
      occurredAt: attributionEvents.occurredAt,
      sourceSystem: attributionEvents.sourceSystem,
      brandId: attributionEvents.brandId,
      intendedBrandId: attributionEvents.intendedBrandId,
      stage: attributionEvents.stage,
      amountMinor: attributionEvents.amountMinor,
      currency: attributionEvents.currency,
      selfReportedSource: attributionEvents.selfReportedSource,
      landingHost: attributionEvents.landingHost,
      referrerHost: attributionEvents.referrerHost,
      utmSource: attributionEvents.utmSource,
      utmMedium: attributionEvents.utmMedium,
      payload: attributionEvents.payload,
      conversionId: attributionConversions.id,
      collectedMinor: attributionConversions.amountMinor,
    })
    .from(attributionEvents)
    .innerJoin(
      attributionImportBatches,
      eq(attributionImportBatches.id, attributionEvents.importBatchId),
    )
    .leftJoin(
      attributionConversions,
      eq(attributionConversions.eventId, attributionEvents.id),
    )
    .where(
      and(
        eq(attributionEvents.projectId, scope.projectId),
        gte(attributionEvents.occurredAt, scope.from),
        lt(attributionEvents.occurredAt, scope.to),
        eq(attributionImportBatches.isDemo, scope.demo),
        eq(attributionEvents.isTest, false),
        eq(attributionEvents.isBot, false),
        inArray(attributionEvents.eventType, PIPELINE_TYPES),
        scope.brandId
          ? or(
              eq(attributionEvents.brandId, scope.brandId),
              eq(attributionEvents.intendedBrandId, scope.brandId),
            )
          : undefined,
      ),
    )
    .orderBy(attributionEvents.occurredAt)
    .limit(MAX_EVENTS);
}

/**
 * The subject each event's identifiers currently resolve to. An event with no
 * identifier node, such as an anonymous call, has no subject and stands alone.
 */
async function subjectsOfEvents(projectId: string, eventIds: string[]) {
  const out = new Map<string, string>();
  for (const ids of chunk(eventIds, IN_CHUNK)) {
    const rows = await db
      .select({
        eventId: attributionEventIdentifiers.eventId,
        subjectId: sql<string>`min(${attributionIdentityNodes.subjectId})`,
      })
      .from(attributionEventIdentifiers)
      .innerJoin(
        attributionIdentityNodes,
        and(
          eq(
            attributionIdentityNodes.projectId,
            attributionEventIdentifiers.projectId,
          ),
          eq(
            attributionIdentityNodes.nodeType,
            attributionEventIdentifiers.identifierType,
          ),
          eq(
            attributionIdentityNodes.nodeValue,
            attributionEventIdentifiers.value,
          ),
        ),
      )
      .where(
        and(
          eq(attributionEventIdentifiers.projectId, projectId),
          inArray(attributionEventIdentifiers.eventId, ids),
        ),
      )
      .groupBy(attributionEventIdentifiers.eventId);
    for (const r of rows) out.set(r.eventId, r.subjectId);
  }
  return out;
}

export const AttributionLeadsRepository = { pipelineEvents, subjectsOfEvents };
