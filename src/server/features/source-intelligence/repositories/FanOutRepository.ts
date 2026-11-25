import { and, desc, eq, lt, max, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiObservationQueries,
  aiObservationRetrievals,
  aiObservations,
  aiPrompts,
  aiPromptSetVersions,
  aiRuns,
  aiSources,
} from "@/db/schema";
import type { SourceFilters } from "@/types/schemas/source-intelligence";
import { inScope, inSourceDomain } from "./sourceScope";

const ROW_LIMIT = 5_000;

const queryReported = sql<number>`case when exists (select 1 from ${aiObservationQueries} where ${aiObservationQueries.observationId} = ${aiObservations.id}) then 1 else 0 end`;

function promptObservations(projectId: string, filters: SourceFilters) {
  return db
    .select({
      promptId: aiPrompts.id,
      prompt: aiPrompts.text,
      locationCode: aiRuns.locationCode,
      languageCode: aiRuns.languageCode,
      total: sql<number>`count(*)`,
      reported: sql<number>`sum(${queryReported})`,
      lastSeen: max(aiObservations.collectedAt),
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .where(and(inScope(projectId, filters), inSourceDomain(filters)))
    .groupBy(
      aiPrompts.id,
      aiPrompts.text,
      aiRuns.locationCode,
      aiRuns.languageCode,
    )
    .orderBy(
      desc(max(aiObservations.collectedAt)),
      aiPrompts.id,
      aiRuns.locationCode,
      aiRuns.languageCode,
    )
    .limit(ROW_LIMIT);
}

function fanOutAnswerRows(
  projectId: string,
  filters: SourceFilters,
  limit: number,
  offset = 0,
) {
  return db
    .select({
      id: aiObservations.id,
      promptId: aiPrompts.id,
      prompt: aiPrompts.text,
      group: aiPrompts.topic,
      engine: aiObservations.engine,
      collectedAt: aiObservations.collectedAt,
      locationCode: aiRuns.locationCode,
      languageCode: aiRuns.languageCode,
      promptVersion: aiPromptSetVersions.version,
      queryReported: queryReported.as("query_reported"),
      queriesExposed: aiObservations.queriesExposed,
      retrievalExposed: aiObservations.retrievalExposed,
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .leftJoin(
      aiPromptSetVersions,
      eq(aiRuns.promptSetVersionId, aiPromptSetVersions.id),
    )
    .where(and(inScope(projectId, filters), inSourceDomain(filters)))
    .orderBy(desc(aiObservations.collectedAt), aiObservations.id)
    .limit(limit)
    .offset(offset);
}

async function fanOutAnswer(projectId: string, observationId: string) {
  const [answer] = await db
    .select({
      id: aiObservations.id,
      prompt: aiPrompts.text,
      promptId: aiPrompts.id,
      engine: aiObservations.engine,
      collectedAt: aiObservations.collectedAt,
      queriesExposed: aiObservations.queriesExposed,
      retrievalExposed: aiObservations.retrievalExposed,
      locationCode: aiRuns.locationCode,
      languageCode: aiRuns.languageCode,
      promptVersion: aiPromptSetVersions.version,
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .leftJoin(
      aiPromptSetVersions,
      eq(aiRuns.promptSetVersionId, aiPromptSetVersions.id),
    )
    .where(
      and(
        eq(aiRuns.projectId, projectId),
        eq(aiObservations.id, observationId),
        eq(aiObservations.status, "completed"),
      ),
    )
    .limit(1);
  if (!answer) return null;

  const [queries, retrieved, cited] = await Promise.all([
    db
      .select({ query: aiObservationQueries.query })
      .from(aiObservationQueries)
      .where(eq(aiObservationQueries.observationId, observationId))
      .orderBy(aiObservationQueries.position),
    db
      .select({
        url: aiObservationRetrievals.url,
        title: aiObservationRetrievals.title,
      })
      .from(aiObservationRetrievals)
      .where(eq(aiObservationRetrievals.observationId, observationId))
      .orderBy(aiObservationRetrievals.position),
    db
      .select({
        url: aiSources.url,
        title: aiSources.title,
        origin: aiSources.origin,
      })
      .from(aiSources)
      .where(eq(aiSources.observationId, observationId))
      .orderBy(aiSources.position),
  ]);
  return {
    ...answer,
    queries: [...new Set(queries.map((row) => row.query))],
    retrieved,
    cited,
  };
}

async function markets(projectId: string) {
  return db
    .selectDistinct({
      locationCode: aiRuns.locationCode,
      languageCode: aiRuns.languageCode,
    })
    .from(aiRuns)
    .where(eq(aiRuns.projectId, projectId))
    .orderBy(aiRuns.locationCode, aiRuns.languageCode);
}

function periodQueries(
  projectId: string,
  filters: SourceFilters,
  start: string,
  end: string,
  limit: number,
) {
  return db
    .select({
      answerId: aiObservations.id,
      promptId: aiObservations.promptId,
      version: aiRuns.promptSetVersionId,
      runAt: aiRuns.createdAt,
      captured: aiObservations.queriesExposed,
      query: sql<string | null>`lower(${aiObservationQueries.query})`,
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .leftJoin(
      aiObservationQueries,
      eq(aiObservationQueries.observationId, aiObservations.id),
    )
    .where(
      and(
        inScope(projectId, filters, start),
        lt(aiRuns.createdAt, end),
        inSourceDomain(filters),
      ),
    )
    .limit(limit);
}

export const FanOutRepository = {
  periodQueries,
  promptObservations,
  fanOutAnswerRows,
  fanOutAnswer,
  markets,
};
