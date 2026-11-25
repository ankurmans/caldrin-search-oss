import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { chunk } from "remeda";
import {
  aiObservations,
  aiPerceptions,
  aiRuns,
  aiPerceptionExperimentPrompts,
  aiPerceptionExperimentReplays,
  aiPerceptionExperiments,
} from "@/db/schema";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";

type ExperimentRow = typeof aiPerceptionExperiments.$inferSelect;
type ReplayInsert = typeof aiPerceptionExperimentReplays.$inferInsert;

// Ten columns per replay row against D1's 100 bound parameters per statement.
const REPLAYS_PER_INSERT = 8;

async function create(
  experiment: typeof aiPerceptionExperiments.$inferInsert,
  promptIds: string[],
) {
  await runBatch((tx) => [
    tx.insert(aiPerceptionExperiments).values(experiment),
    tx.insert(aiPerceptionExperimentPrompts).values(
      promptIds.map((promptId) => ({
        experimentId: experiment.id,
        promptId,
      })),
    ),
  ]);
}

async function list(projectId: string) {
  const rows = await db
    .select({
      experiment: aiPerceptionExperiments,
      prompts: sql<number>`(select count(*) from ${aiPerceptionExperimentPrompts} where ${aiPerceptionExperimentPrompts.experimentId} = ${aiPerceptionExperiments.id})`,
    })
    .from(aiPerceptionExperiments)
    .where(eq(aiPerceptionExperiments.projectId, projectId))
    .orderBy(desc(aiPerceptionExperiments.createdAt));
  return rows.map((r) => ({ ...r.experiment, prompts: Number(r.prompts) }));
}

async function get(projectId: string, id: string) {
  const experiment: ExperimentRow | undefined = (
    await db
      .select()
      .from(aiPerceptionExperiments)
      .where(eq(aiPerceptionExperiments.id, id))
      .limit(1)
  )[0];
  if (!experiment || experiment.projectId !== projectId) return null;
  const [prompts, replays] = await Promise.all([
    db
      .select({ promptId: aiPerceptionExperimentPrompts.promptId })
      .from(aiPerceptionExperimentPrompts)
      .where(eq(aiPerceptionExperimentPrompts.experimentId, id)),
    db
      .select()
      .from(aiPerceptionExperimentReplays)
      .where(eq(aiPerceptionExperimentReplays.experimentId, id)),
  ]);
  return { experiment, promptIds: prompts.map((p) => p.promptId), replays };
}

/** Replaces the earlier replay of an experiment, so a rerun never mixes two. */
async function saveReplay(input: {
  experimentId: string;
  model: string | null;
  costUsd: number;
  replayedAt: string;
  replays: ReplayInsert[];
}) {
  await runBatch((tx) => [
    tx
      .delete(aiPerceptionExperimentReplays)
      .where(
        eq(aiPerceptionExperimentReplays.experimentId, input.experimentId),
      ),
    ...chunk(input.replays, REPLAYS_PER_INSERT).map((rows) =>
      tx.insert(aiPerceptionExperimentReplays).values(rows),
    ),
    tx
      .update(aiPerceptionExperiments)
      .set({
        status: "replayed",
        model: input.model,
        costUsd: input.costUsd,
        replayedAt: input.replayedAt,
        approvedAt: null,
        approvedBy: null,
        opportunityId: null,
      })
      .where(eq(aiPerceptionExperiments.id, input.experimentId)),
  ]);
}

async function markApproved(input: {
  id: string;
  opportunityId: string;
  approvedAt: string;
  approvedBy: "person" | "agent";
}) {
  await db
    .update(aiPerceptionExperiments)
    .set({
      status: "approved",
      opportunityId: input.opportunityId,
      approvedAt: input.approvedAt,
      approvedBy: input.approvedBy,
    })
    .where(eq(aiPerceptionExperiments.id, input.id));
}

async function updateDraft(
  id: string,
  fields: Partial<
    Pick<
      typeof aiPerceptionExperiments.$inferInsert,
      | "title"
      | "sourceUrl"
      | "originalText"
      | "editedText"
      | "assumptions"
      | "repeats"
    >
  >,
  promptIds: string[] | null,
) {
  await runBatch((tx) => [
    tx
      .update(aiPerceptionExperiments)
      .set({
        ...fields,
        // Any edit makes the old replay say nothing about the new text.
        status: "draft",
        replayedAt: null,
        approvedAt: null,
        approvedBy: null,
        opportunityId: null,
      })
      .where(eq(aiPerceptionExperiments.id, id)),
    tx
      .delete(aiPerceptionExperimentReplays)
      .where(eq(aiPerceptionExperimentReplays.experimentId, id)),
    ...(promptIds
      ? [
          tx
            .delete(aiPerceptionExperimentPrompts)
            .where(eq(aiPerceptionExperimentPrompts.experimentId, id)),
          tx
            .insert(aiPerceptionExperimentPrompts)
            .values(
              promptIds.map((promptId) => ({ experimentId: id, promptId })),
            ),
        ]
      : []),
  ]);
}

/** How saved real answers for these prompts read the brand, per prompt. */
async function realReadings(
  projectId: string,
  promptIds: string[],
  domain: string,
  version: string,
) {
  const rows: {
    promptId: string;
    stance: string;
    reviewedStance: string | null;
  }[] = [];
  for (const ids of chunk(promptIds, 80))
    rows.push(
      ...(await db
        .select({
          promptId: aiObservations.promptId,
          stance: aiPerceptions.stance,
          reviewedStance: aiPerceptions.reviewedStance,
        })
        .from(aiPerceptions)
        .innerJoin(
          aiObservations,
          eq(aiObservations.id, aiPerceptions.observationId),
        )
        .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
        .where(
          and(
            eq(aiRuns.projectId, projectId),
            inArray(aiObservations.promptId, ids),
            eq(aiPerceptions.domain, domain),
            eq(aiPerceptions.classifierVersion, version),
          ),
        )),
    );
  return rows;
}

async function remove(projectId: string, id: string) {
  const found = await get(projectId, id);
  if (!found) return false;
  await db
    .delete(aiPerceptionExperiments)
    .where(inArray(aiPerceptionExperiments.id, [id]));
  return true;
}

export const AiPerceptionExperimentRepository = {
  create,
  list,
  get,
  saveReplay,
  markApproved,
  updateDraft,
  realReadings,
  remove,
};
