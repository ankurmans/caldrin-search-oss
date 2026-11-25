import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  aiPromptSetMembers,
  aiPromptSetVersions,
  aiPrompts,
  aiRuns,
} from "@/db/schema";

export type PromptSetVersionRow = typeof aiPromptSetVersions.$inferSelect;

async function getLatestVersion(trackerId: string) {
  return (
    (
      await db
        .select()
        .from(aiPromptSetVersions)
        .where(eq(aiPromptSetVersions.trackerId, trackerId))
        .orderBy(desc(aiPromptSetVersions.version))
        .limit(1)
    )[0] ?? null
  );
}

async function listActivePromptIds(trackerId: string) {
  return (
    await db
      .select({ id: aiPrompts.id })
      .from(aiPrompts)
      .where(
        and(
          eq(aiPrompts.trackerId, trackerId),
          eq(aiPrompts.paused, false),
          eq(aiPrompts.archived, false),
        ),
      )
  ).map((row) => row.id);
}

async function listMemberIds(versionId: string) {
  return (
    await db
      .select({ promptId: aiPromptSetMembers.promptId })
      .from(aiPromptSetMembers)
      .where(eq(aiPromptSetMembers.versionId, versionId))
  ).map((row) => row.promptId);
}

/** The version and its members in one atomic batch; a duplicate number fails. */
async function insertVersion(
  version: typeof aiPromptSetVersions.$inferInsert,
  promptIds: string[],
) {
  await runBatch((tx) => [
    tx.insert(aiPromptSetVersions).values(version),
    // Two bound columns per member keeps each statement under D1's limit.
    ...chunk(promptIds, 40).map((ids) =>
      tx
        .insert(aiPromptSetMembers)
        .values(ids.map((promptId) => ({ versionId: version.id, promptId }))),
    ),
  ]);
}

async function listVersions(trackerId: string) {
  return db
    .select()
    .from(aiPromptSetVersions)
    .where(eq(aiPromptSetVersions.trackerId, trackerId))
    .orderBy(desc(aiPromptSetVersions.version));
}

async function listMembers(versionIds: string[]) {
  if (!versionIds.length) return [];
  return db
    .select({
      versionId: aiPromptSetMembers.versionId,
      promptId: aiPromptSetMembers.promptId,
      text: aiPrompts.text,
      topic: aiPrompts.topic,
    })
    .from(aiPromptSetMembers)
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiPromptSetMembers.promptId))
    .where(inArray(aiPromptSetMembers.versionId, versionIds));
}

async function countRunsByVersion(projectId: string) {
  return db
    .select({
      versionId: aiRuns.promptSetVersionId,
      runs: sql<number>`count(*)`.mapWith(Number),
    })
    .from(aiRuns)
    .where(eq(aiRuns.projectId, projectId))
    .groupBy(aiRuns.promptSetVersionId);
}

export const AiPromptSetVersionRepository = {
  getLatestVersion,
  listActivePromptIds,
  listMemberIds,
  insertVersion,
  listVersions,
  listMembers,
  countRunsByVersion,
};
