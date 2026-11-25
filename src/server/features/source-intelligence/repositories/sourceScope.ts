import { and, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import {
  aiMatches,
  aiObservationRetrievals,
  aiObservations,
  aiPrompts,
  aiRuns,
  aiSources,
} from "@/db/schema";
import { aiMarketCondition } from "@/server/features/ai-visibility/repositories/aiMarketFilter";
import type { SourceFilters } from "@/types/schemas/source-intelligence";

/** Completed answers of one project inside the filters. */
export function inScope(
  projectId: string,
  filters: SourceFilters,
  since = new Date(Date.now() - filters.days * 86_400_000).toISOString(),
): SQL {
  return (
    and(
      eq(aiRuns.projectId, projectId),
      filters.locationCode
        ? aiMarketCondition({
            locationCode: filters.locationCode,
            languageCode: filters.languageCode ?? undefined,
          })
        : undefined,
      filters.promptId
        ? eq(aiObservations.promptId, filters.promptId)
        : undefined,
      eq(aiObservations.status, "completed"),
      gte(aiRuns.createdAt, since),
      filters.engine
        ? eq(aiObservations.engine, filters.engine)
        : filters.engines?.length
          ? inArray(aiObservations.engine, filters.engines)
          : undefined,
      filters.promptGroup
        ? eq(aiPrompts.topic, filters.promptGroup)
        : undefined,
      filters.brandDomain
        ? sql`exists (select 1 from ${aiMatches} where ${aiMatches.observationId} = ${aiObservations.id} and ${aiMatches.domain} = ${filters.brandDomain} and (${aiMatches.mentioned} or ${aiMatches.cited}))`
        : undefined,
    ) ?? sql`true`
  );
}

export function inSourceDomain(filters: SourceFilters) {
  if (!filters.sourceDomain) return;
  const domain = filters.sourceDomain.toLowerCase();
  return sql`(exists (select 1 from ${aiSources} where ${aiSources.observationId} = ${aiObservations.id} and ${aiSources.domain} = ${domain}) or exists (select 1 from ${aiObservationRetrievals} where ${aiObservationRetrievals.observationId} = ${aiObservations.id} and ${aiObservationRetrievals.domain} = ${domain}))`;
}
