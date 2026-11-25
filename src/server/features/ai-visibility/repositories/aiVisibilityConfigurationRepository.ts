import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { normalizeAiSuggestion } from "@/shared/ai-prompt-suggestions";
import { aiTrackers, aiPrompts, projects } from "@/db/schema";
import type { aiRuns, aiObservations } from "@/db/schema";

export type TrackerRow = typeof aiTrackers.$inferSelect;
export type PromptRow = typeof aiPrompts.$inferSelect;
export type RunRow = typeof aiRuns.$inferSelect;
export type ObservationRow = typeof aiObservations.$inferSelect;
type Tx = Parameters<Parameters<typeof runBatch>[0]>[0];
export interface ConfigurationRows {
  tracker: TrackerRow;
  prompts: PromptRow[];
}

export async function getTracker(projectId: string) {
  return (
    (
      await db
        .select()
        .from(aiTrackers)
        .where(eq(aiTrackers.projectId, projectId))
        .limit(1)
    )[0] ?? null
  );
}

export async function getConfiguration(
  projectId: string,
): Promise<ConfigurationRows | null> {
  const tracker = await getTracker(projectId);
  if (!tracker) return null;
  const prompts = await db
    .select()
    .from(aiPrompts)
    .where(eq(aiPrompts.trackerId, tracker.id))
    .orderBy(asc(aiPrompts.createdAt), asc(aiPrompts.id));
  return { tracker, prompts };
}

export async function saveConfiguration(rows: ConfigurationRows) {
  await runBatch((tx) => writeConfiguration(tx, rows));
}

/** Upserts the tracker's collection settings and every prompt. */
export function writeConfiguration(tx: Tx, rows: ConfigurationRows) {
  const { tracker } = rows;
  return [
    tx
      .insert(aiTrackers)
      .values(tracker)
      .onConflictDoUpdate({
        target: aiTrackers.id,
        set: {
          chatgpt: tracker.chatgpt,
          gemini: tracker.gemini,
          googleAiOverview: tracker.googleAiOverview,
          googleAiMode: tracker.googleAiMode,
          claude: tracker.claude,
          perplexity: tracker.perplexity,
          locationCode: tracker.locationCode,
          languageCode: tracker.languageCode,
        },
      }),
    ...rows.prompts.map((prompt) =>
      tx
        .insert(aiPrompts)
        .values(prompt)
        .onConflictDoUpdate({
          target: aiPrompts.id,
          set: {
            topic: prompt.topic,
            paused: prompt.paused,
            archived: prompt.archived,
            intent: prompt.intent,
          },
        }),
    ),
  ];
}

/**
 * Removes one Prompt Research keyword. The column is left empty, not null, when
 * the last one goes: null means setup never ran, and only null is refilled, so
 * a deleted keyword does not come back.
 */
export async function removeResearchKeyword(
  projectId: string,
  keyword: string,
): Promise<boolean> {
  const row = (
    await db
      .select({ keywords: projects.aiResearchKeywords })
      .from(projects)
      .where(eq(projects.id, projectId))
  )[0];
  if (row?.keywords === null || row?.keywords === undefined) return false;
  const lines = row.keywords.split("\n").filter(Boolean);
  const target = normalizeAiSuggestion(keyword);
  const kept = lines.filter((line) => normalizeAiSuggestion(line) !== target);
  if (kept.length === lines.length) return false;
  await db
    .update(projects)
    .set({ aiResearchKeywords: kept.join("\n") })
    .where(eq(projects.id, projectId));
  return true;
}

/** Fills a project's missing Prompt Research keywords, in the given order. */
export function writeResearchKeywords(
  tx: Tx,
  projectId: string,
  names: string[],
) {
  // One keyword per line, so a keyword itself never holds a line break.
  const keywords = [
    ...new Map(
      names.map((name) => [
        normalizeAiSuggestion(name),
        name.replace(/\s+/g, " ").trim(),
      ]),
    ).values(),
  ].filter(Boolean);
  return [
    tx
      .update(projects)
      .set({ aiResearchKeywords: keywords.join("\n") || null })
      .where(
        and(eq(projects.id, projectId), isNull(projects.aiResearchKeywords)),
      ),
  ];
}
