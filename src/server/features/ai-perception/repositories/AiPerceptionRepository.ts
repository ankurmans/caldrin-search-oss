import { and, asc, eq, inArray } from "drizzle-orm";
import { chunk } from "remeda";
import {
  aiMatches,
  aiObservationRetrievals,
  aiObservations,
  aiPerceptionComparisons,
  aiPerceptionPoints,
  aiPerceptionReviews,
  aiPerceptions,
  aiRuns,
} from "@/db/schema";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import type {
  PerceptionSentiment,
  PerceptionStance,
} from "@/shared/ai-perception";

type Perception = typeof aiPerceptions.$inferSelect;
type Point = typeof aiPerceptionPoints.$inferSelect;
type Comparison = typeof aiPerceptionComparisons.$inferSelect;

type StoredPerception = Perception & {
  points: Point[];
  comparisons: Comparison[];
};

export interface PerceptionToSave {
  perception: typeof aiPerceptions.$inferInsert;
  points: Omit<typeof aiPerceptionPoints.$inferInsert, "perceptionId">[];
  comparisons: Omit<
    typeof aiPerceptionComparisons.$inferInsert,
    "perceptionId"
  >[];
}

// Keep every IN list under D1's bind limit.
const IN_LIMIT = 80;

/** Hosts each answer's engine retrieved, for answers on engines that report it. */
async function listRetrievedDomains(observationIds: string[]) {
  const rows: { observationId: string; domain: string }[] = [];
  for (const ids of chunk(observationIds, IN_LIMIT))
    rows.push(
      ...(await db
        .selectDistinct({
          observationId: aiObservationRetrievals.observationId,
          domain: aiObservationRetrievals.domain,
        })
        .from(aiObservationRetrievals)
        .where(inArray(aiObservationRetrievals.observationId, ids))),
    );
  return rows;
}

async function listForObservations(
  observationIds: string[],
  classifierVersion?: string,
): Promise<StoredPerception[]> {
  const rows: Perception[] = [];
  for (let offset = 0; offset < observationIds.length; offset += IN_LIMIT)
    rows.push(
      ...(await db
        .select()
        .from(aiPerceptions)
        .where(
          and(
            inArray(
              aiPerceptions.observationId,
              observationIds.slice(offset, offset + IN_LIMIT),
            ),
            classifierVersion
              ? eq(aiPerceptions.classifierVersion, classifierVersion)
              : undefined,
          ),
        )),
    );
  const points: Point[] = [];
  const comparisons: Comparison[] = [];
  const ids = rows.map((r) => r.id);
  for (let offset = 0; offset < ids.length; offset += IN_LIMIT) {
    const part = ids.slice(offset, offset + IN_LIMIT);
    points.push(
      ...(await db
        .select()
        .from(aiPerceptionPoints)
        .where(inArray(aiPerceptionPoints.perceptionId, part))),
    );
    comparisons.push(
      ...(await db
        .select()
        .from(aiPerceptionComparisons)
        .where(inArray(aiPerceptionComparisons.perceptionId, part))),
    );
  }
  return rows.map((row) => ({
    ...row,
    points: points.filter((p) => p.perceptionId === row.id),
    comparisons: comparisons.filter((c) => c.perceptionId === row.id),
  }));
}

/**
 * Saves one reading with its points and comparisons, and keeps the sentiment
 * on the answer's match row in step so older views show the same label.
 */
async function save(item: PerceptionToSave) {
  const id = item.perception.id;
  await runBatch((tx) => [
    tx
      .delete(aiPerceptions)
      .where(
        and(
          eq(aiPerceptions.observationId, item.perception.observationId),
          eq(aiPerceptions.domain, item.perception.domain),
          eq(
            aiPerceptions.classifierVersion,
            item.perception.classifierVersion,
          ),
        ),
      ),
    tx.insert(aiPerceptions).values(item.perception),
    // Five columns per row: D1 allows 100 bound parameters per statement.
    ...chunk(item.points, 15).map((rows) =>
      tx
        .insert(aiPerceptionPoints)
        .values(rows.map((r) => ({ ...r, perceptionId: id }))),
    ),
    ...chunk(item.comparisons, 15).map((rows) =>
      tx
        .insert(aiPerceptionComparisons)
        .values(rows.map((r) => ({ ...r, perceptionId: id }))),
    ),
    tx
      .update(aiMatches)
      .set({
        sentiment: item.perception.sentiment,
        sentimentModel: item.perception.model,
        sentimentClassifiedAt: item.perception.classifiedAt,
      })
      .where(
        and(
          eq(aiMatches.observationId, item.perception.observationId),
          eq(aiMatches.domain, item.perception.domain),
        ),
      ),
  ]);
}

/** Runs are read in slices so every IN list stays under D1's bind limit. */
const RUN_SLICE = 20;

/**
 * The readings of the given runs' answers, without their points or
 * comparisons. Callers pass run ids already scoped to one project.
 */
async function listForRuns(
  runIds: string[],
  classifierVersion: string,
  domain?: string,
): Promise<Perception[]> {
  const rows: Perception[] = [];
  for (let offset = 0; offset < runIds.length; offset += RUN_SLICE) {
    const part = await db
      .select({ perception: aiPerceptions })
      .from(aiPerceptions)
      .innerJoin(
        aiObservations,
        eq(aiObservations.id, aiPerceptions.observationId),
      )
      .where(
        and(
          inArray(
            aiObservations.runId,
            runIds.slice(offset, offset + RUN_SLICE),
          ),
          eq(aiPerceptions.classifierVersion, classifierVersion),
          domain === undefined ? undefined : eq(aiPerceptions.domain, domain),
        ),
      );
    rows.push(...part.map((r) => r.perception));
  }
  return rows;
}

/** The reading, only when its answer belongs to the project. */
async function getForProject(projectId: string, id: string) {
  const [row] = await db
    .select({ perception: aiPerceptions })
    .from(aiPerceptions)
    .innerJoin(
      aiObservations,
      eq(aiObservations.id, aiPerceptions.observationId),
    )
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .where(and(eq(aiPerceptions.id, id), eq(aiRuns.projectId, projectId)))
    .limit(1);
  return row?.perception ?? null;
}

/** Records a person's correction and the history entries that explain it. */
async function review(input: {
  perception: Perception;
  reviewedStance: PerceptionStance;
  reviewedSentiment: PerceptionSentiment;
  entries: Omit<typeof aiPerceptionReviews.$inferInsert, "perceptionId">[];
  matchSentimentModel: string;
}) {
  const { perception } = input;
  await runBatch((tx) => [
    tx
      .update(aiPerceptions)
      .set({
        reviewedStance: input.reviewedStance,
        reviewedSentiment: input.reviewedSentiment,
      })
      .where(eq(aiPerceptions.id, perception.id)),
    ...input.entries.map((entry) =>
      tx
        .insert(aiPerceptionReviews)
        .values({ ...entry, perceptionId: perception.id }),
    ),
    tx
      .update(aiMatches)
      .set({
        sentiment: input.reviewedSentiment,
        sentimentModel: input.matchSentimentModel,
      })
      .where(
        and(
          eq(aiMatches.observationId, perception.observationId),
          eq(aiMatches.domain, perception.domain),
        ),
      ),
  ]);
}

const listReviews = (perceptionId: string) =>
  db
    .select()
    .from(aiPerceptionReviews)
    .where(eq(aiPerceptionReviews.perceptionId, perceptionId))
    .orderBy(asc(aiPerceptionReviews.reviewedAt));

export const AiPerceptionRepository = {
  listRetrievedDomains,
  listForObservations,
  listForRuns,
  save,
  getForProject,
  review,
  listReviews,
};
