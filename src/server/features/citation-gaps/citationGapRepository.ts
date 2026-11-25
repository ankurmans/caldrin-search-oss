import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { aiObservations, aiSources } from "@/db/schema";
import type { CitedSource } from "./citationSourceRules";

/** Runs and observations are read in slices so IN lists stay under D1's bind limit. */
const SLICE = 20;

function slices<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/**
 * Cited pages of the given runs' answered collections. Callers pass run ids
 * already scoped to one project; observations carry no project column.
 */
async function listCitedSources(runIds: string[]): Promise<CitedSource[]> {
  const rows: CitedSource[] = [];
  for (const ids of slices(runIds, SLICE))
    rows.push(
      ...(await db
        .select({
          observationId: aiSources.observationId,
          url: aiSources.url,
          domain: aiSources.domain,
          title: aiSources.title,
          position: aiSources.position,
        })
        .from(aiSources)
        .innerJoin(
          aiObservations,
          eq(aiObservations.id, aiSources.observationId),
        )
        .where(
          and(
            inArray(aiObservations.runId, ids),
            eq(aiObservations.status, "completed"),
            isNotNull(aiObservations.answerMarkdown),
          ),
        )),
    );
  return rows;
}

/** Saved answer text of observations that belong to the given runs only. */
async function getAnswerMarkdown(
  runIds: string[],
  observationIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const ids of slices(observationIds, 50)) {
    const rows = await db
      .select({
        id: aiObservations.id,
        runId: aiObservations.runId,
        markdown: aiObservations.answerMarkdown,
      })
      .from(aiObservations)
      .where(inArray(aiObservations.id, ids));
    for (const row of rows)
      if (row.markdown && runIds.includes(row.runId))
        out.set(row.id, row.markdown);
  }
  return out;
}

export const CitationGapRepository = { listCitedSources, getAnswerMarkdown };
