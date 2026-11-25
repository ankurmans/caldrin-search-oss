import { and, countDistinct, desc, eq, max } from "drizzle-orm";
import { db } from "@/db";
import {
  aiMatches,
  aiObservations,
  aiPrompts,
  aiRuns,
  aiSources,
} from "@/db/schema";
import type { SourceFilters } from "@/types/schemas/source-intelligence";
import { inScope } from "./sourceScope";

export function competitorCitations(projectId: string, filters: SourceFilters) {
  const occurrences = countDistinct(aiSources.observationId);
  return db
    .select({
      url: aiSources.url,
      name: max(aiMatches.name),
      domain: aiMatches.domain,
      answers: occurrences,
    })
    .from(aiSources)
    .innerJoin(aiObservations, eq(aiObservations.id, aiSources.observationId))
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .innerJoin(aiMatches, eq(aiMatches.observationId, aiObservations.id))
    .where(
      and(
        inScope(projectId, filters),
        filters.sourceDomain
          ? eq(aiSources.domain, filters.sourceDomain.toLowerCase())
          : undefined,
        eq(aiMatches.own, false),
        eq(aiMatches.mentioned, true),
      ),
    )
    .groupBy(aiSources.url, aiMatches.domain)
    .orderBy(desc(occurrences), aiSources.url, aiMatches.domain)
    .limit(5000);
}
