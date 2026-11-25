import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  sql,
} from "drizzle-orm";
import { sort } from "remeda";
import { db } from "@/db";
import { aiMatches, aiObservations, aiRuns, aiSources } from "@/db/schema";
import { aiMarketCondition } from "./aiMarketFilter";
import { type AiMarketQuery } from "@/shared/ai-market";

/** Runs are read in slices so every IN list stays under D1's bind limit. */
const RUN_SLICE = 20;

function slices<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size)
    result.push(items.slice(offset, offset + size));
  return result;
}

/** Runs of this project only; ids from another project are simply absent. */
async function getProjectRuns(projectId: string, runIds: string[]) {
  const rows = [];
  for (const ids of slices(runIds, RUN_SLICE))
    rows.push(
      ...(await db
        .select()
        .from(aiRuns)
        .where(and(eq(aiRuns.projectId, projectId), inArray(aiRuns.id, ids)))),
    );
  return sort(
    rows,
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** Completed or partial runs (any trigger; failed ones add no answers) created inside the window, oldest first. */
async function listFinishedRunsInWindow(
  projectId: string,
  window: { start: string; end: string },
  limit: number,
  market?: AiMarketQuery | null,
) {
  return db
    .select()
    .from(aiRuns)
    .where(
      and(
        eq(aiRuns.projectId, projectId),
        inArray(aiRuns.status, ["completed", "partial"]),
        gte(aiRuns.createdAt, window.start),
        lte(aiRuns.createdAt, window.end),
        aiMarketCondition(market),
      ),
    )
    .orderBy(asc(aiRuns.createdAt), asc(aiRuns.id))
    .limit(limit);
}

/** Newest-first completed or partial runs of this project, optionally bounded by creation time. */
async function listFinishedRuns(
  projectId: string,
  range: { from?: string; to?: string },
  limit: number,
  market?: AiMarketQuery | null,
) {
  return db
    .select()
    .from(aiRuns)
    .where(
      and(
        eq(aiRuns.projectId, projectId),
        inArray(aiRuns.status, ["completed", "partial"]),
        range.from ? gte(aiRuns.createdAt, range.from) : undefined,
        range.to ? lte(aiRuns.createdAt, range.to) : undefined,
        aiMarketCondition(market),
      ),
    )
    .orderBy(desc(aiRuns.createdAt), desc(aiRuns.id))
    .limit(limit);
}

/**
 * Engine, reported model and prompt count per run. The runs are already
 * project-scoped by the caller; observations have no project column.
 */
async function getRunShapes(runIds: string[]) {
  const rows = [];
  for (const ids of slices(runIds, RUN_SLICE))
    rows.push(
      ...(await db
        .select({
          runId: aiObservations.runId,
          engine: aiObservations.engine,
          model: aiObservations.model,
          prompts:
            sql<number>`count(distinct ${aiObservations.promptId})`.mapWith(
              Number,
            ),
        })
        .from(aiObservations)
        .where(inArray(aiObservations.runId, ids))
        .groupBy(
          aiObservations.runId,
          aiObservations.engine,
          aiObservations.model,
        )),
    );
  return rows;
}

/** One row per planned answer with the own brand's result. */
async function getAnswerFacts(runIds: string[]) {
  const rows = [];
  for (const ids of slices(runIds, RUN_SLICE))
    rows.push(
      ...(await db
        .select({
          observationId: aiObservations.id,
          runId: aiObservations.runId,
          promptId: aiObservations.promptId,
          engine: aiObservations.engine,
          status: aiObservations.status,
          model: aiObservations.model,
          branded: aiObservations.branded,
          collectedAt: aiObservations.collectedAt,
          // Not the answer itself: only whether the engine gave one.
          hasAnswer:
            sql<number>`CASE WHEN ${aiObservations.answerMarkdown} IS NULL THEN 0 ELSE 1 END`.mapWith(
              Number,
            ),
          ownName: aiMatches.name,
          ownDomain: aiMatches.domain,
          mentioned: aiMatches.mentioned,
          cited: aiMatches.cited,
          recommended: aiMatches.recommended,
        })
        .from(aiObservations)
        .leftJoin(
          aiMatches,
          and(
            eq(aiMatches.observationId, aiObservations.id),
            eq(aiMatches.own, true),
          ),
        )
        .where(inArray(aiObservations.runId, ids))),
    );
  return rows;
}

/** Competitor results of completed answers, for competitor context. */
async function getCompetitorMatches(runIds: string[]) {
  const rows = [];
  for (const ids of slices(runIds, RUN_SLICE))
    rows.push(
      ...(await db
        .select({
          observationId: aiMatches.observationId,
          name: aiMatches.name,
          domain: aiMatches.domain,
          mentioned: aiMatches.mentioned,
          cited: aiMatches.cited,
        })
        .from(aiMatches)
        .innerJoin(
          aiObservations,
          eq(aiObservations.id, aiMatches.observationId),
        )
        .where(
          and(
            inArray(aiObservations.runId, ids),
            eq(aiObservations.status, "completed"),
            isNotNull(aiObservations.answerMarkdown),
            eq(aiMatches.own, false),
          ),
        )),
    );
  return rows;
}

/**
 * Answers citing each domain and page, per engine. An answer counts once per
 * domain or page however many of its sources point there.
 */
async function getCitedSources(runIds: string[]) {
  const domains: { engine: string; key: string; answers: number }[] = [];
  const urls: { engine: string; key: string; answers: number }[] = [];
  const answers =
    sql<number>`count(distinct ${aiSources.observationId})`.mapWith(Number);
  for (const ids of slices(runIds, RUN_SLICE)) {
    const where = and(
      inArray(aiObservations.runId, ids),
      eq(aiObservations.status, "completed"),
      isNotNull(aiObservations.answerMarkdown),
    );
    domains.push(
      ...(await db
        .select({
          engine: aiObservations.engine,
          key: aiSources.domain,
          answers,
        })
        .from(aiSources)
        .innerJoin(
          aiObservations,
          eq(aiObservations.id, aiSources.observationId),
        )
        .where(where)
        .groupBy(aiObservations.engine, aiSources.domain)),
    );
    urls.push(
      ...(await db
        .select({
          engine: aiObservations.engine,
          key: aiSources.url,
          answers,
        })
        .from(aiSources)
        .innerJoin(
          aiObservations,
          eq(aiObservations.id, aiSources.observationId),
        )
        .where(where)
        .groupBy(aiObservations.engine, aiSources.url)),
    );
  }
  return { domains, urls };
}

export const AiMeasurementRepository = {
  getProjectRuns,
  listFinishedRunsInWindow,
  listFinishedRuns,
  getRunShapes,
  getAnswerFacts,
  getCompetitorMatches,
  getCitedSources,
};
