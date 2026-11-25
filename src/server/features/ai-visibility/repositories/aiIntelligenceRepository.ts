import { eq, inArray, sql } from "drizzle-orm";
import { groupByProp } from "remeda";
import { db } from "@/db";
import {
  aiMatches,
  aiObservations,
  aiPerceptions,
  aiPrompts,
} from "@/db/schema";
import { perceptionOf, recommendedOf } from "./perceptionRecommended";
import type { IntelFact } from "../services/aiVisibilityIntelligenceMetrics";

/** Runs are read in slices so every IN list stays under D1's bind limit. */
const RUN_SLICE = 20;

function slices<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size)
    result.push(items.slice(offset, offset + size));
  return result;
}

/**
 * Every planned collection of the given runs with each tracked brand's result.
 * Callers pass run ids already scoped to one project; observations carry no
 * project column. The answer text itself is not read.
 */
async function getFacts(runIds: string[]): Promise<IntelFact[]> {
  const observations = [];
  const matches = [];
  for (const ids of slices(runIds, RUN_SLICE)) {
    observations.push(
      ...(await db
        .select({
          id: aiObservations.id,
          runId: aiObservations.runId,
          promptId: aiObservations.promptId,
          prompt: aiPrompts.text,
          topic: aiPrompts.topic,
          intent: aiPrompts.intent,
          branded: aiObservations.branded,
          engine: aiObservations.engine,
          status: aiObservations.status,
          model: aiObservations.model,
          collectedAt: aiObservations.collectedAt,
          hasAnswer:
            sql<number>`CASE WHEN ${aiObservations.answerMarkdown} IS NULL THEN 0 ELSE 1 END`.mapWith(
              Number,
            ),
        })
        .from(aiObservations)
        .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
        .where(inArray(aiObservations.runId, ids))),
    );
    matches.push(
      ...(await db
        .select({
          observationId: aiMatches.observationId,
          name: aiMatches.name,
          domain: aiMatches.domain,
          own: aiMatches.own,
          mentioned: aiMatches.mentioned,
          cited: aiMatches.cited,
          recommended: recommendedOf,
          firstMention: aiMatches.firstMention,
          sentiment: aiMatches.sentiment,
        })
        .from(aiMatches)
        .innerJoin(
          aiObservations,
          eq(aiObservations.id, aiMatches.observationId),
        )
        .leftJoin(aiPerceptions, perceptionOf)
        .where(inArray(aiObservations.runId, ids))),
    );
  }
  const byObservation = groupByProp(matches, "observationId");
  return observations.map(({ hasAnswer, ...row }) => ({
    ...row,
    hasAnswer: hasAnswer === 1,
    brands: (byObservation[row.id] ?? []).map(
      ({ observationId: _, recommended, ...brand }) => ({
        ...brand,
        recommended: recommended === null ? null : Boolean(recommended),
      }),
    ),
  }));
}

export const AiIntelligenceRepository = { getFacts };
