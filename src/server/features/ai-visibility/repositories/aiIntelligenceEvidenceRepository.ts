import { aiMarketCondition } from "./aiMarketFilter";
import { type AiMarketQuery } from "@/shared/ai-market";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  aiMatches,
  aiObservations,
  aiPerceptions,
  aiPrompts,
  aiRuns,
} from "@/db/schema";
import { perceptionOf, recommendedOf } from "./perceptionRecommended";
import type { AiEngine } from "@/shared/ai-visibility";
import type { AiPromptIntent } from "@/shared/ai-prompt-intent";
import type { IntelEvidenceCursor } from "@/shared/ai-visibility-intelligence";

/**
 * The runs a figure was computed from, as bounds instead of an id list so
 * every statement binds a fixed number of parameters. The finished runs of
 * one prompt set created between the oldest and newest selected run are
 * exactly the selected runs.
 */
interface EvidenceRunScope {
  projectId: string;
  promptSetVersionId: string | null;
  from: string;
  to: string;
  market?: AiMarketQuery | null;
}

interface EvidenceFilters {
  engines: AiEngine[] | null;
  topic: string | null;
  branded: "all" | "branded" | "unbranded";
  intents: (AiPromptIntent | "unknown")[] | null;
}

const count = (condition: SQL) =>
  sql<number>`sum(case when ${condition} then 1 else 0 end)`.mapWith(Number);

function inScope(scope: EvidenceRunScope) {
  return and(
    eq(aiRuns.projectId, scope.projectId),
    inArray(aiRuns.status, ["completed", "partial"]),
    scope.promptSetVersionId === null
      ? isNull(aiRuns.promptSetVersionId)
      : eq(aiRuns.promptSetVersionId, scope.promptSetVersionId),
    gte(aiRuns.createdAt, scope.from),
    lte(aiRuns.createdAt, scope.to),
    aiMarketCondition(scope.market),
  );
}

/** Answered collections of the scoped runs that track `domain`, filtered. */
function answeredFor(
  scope: EvidenceRunScope,
  filters: EvidenceFilters,
  domain: string,
) {
  const known = (filters.intents ?? []).filter(
    (i): i is AiPromptIntent => i !== "unknown",
  );
  return and(
    inScope(scope),
    eq(aiObservations.status, "completed"),
    isNotNull(aiObservations.answerMarkdown),
    eq(aiMatches.domain, domain),
    filters.engines
      ? inArray(aiObservations.engine, filters.engines)
      : undefined,
    filters.topic ? eq(aiPrompts.topic, filters.topic) : undefined,
    filters.branded === "all"
      ? undefined
      : eq(aiObservations.branded, filters.branded === "branded"),
    filters.intents
      ? or(
          known.length ? inArray(aiPrompts.intent, known) : undefined,
          filters.intents.includes("unknown")
            ? isNull(aiPrompts.intent)
            : undefined,
        )
      : undefined,
  );
}

/** The next `limit` prompts after `cursor`, in topic, text, id order. */
async function listPrompts(
  scope: EvidenceRunScope,
  filters: EvidenceFilters,
  domain: string,
  cursor: IntelEvidenceCursor | null,
  limit: number,
) {
  const rows = await db
    .select({
      promptId: aiPrompts.id,
      prompt: aiPrompts.text,
      topic: aiPrompts.topic,
      intent: aiPrompts.intent,
      branded:
        sql<number>`max(case when ${aiObservations.branded} then 1 else 0 end)`.mapWith(
          Number,
        ),
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .innerJoin(aiMatches, eq(aiMatches.observationId, aiObservations.id))
    .where(
      and(
        answeredFor(scope, filters, domain),
        cursor
          ? sql`(${aiPrompts.topic}, ${aiPrompts.text}, ${aiPrompts.id}) > (${cursor.topic}, ${cursor.prompt}, ${cursor.promptId})`
          : undefined,
      ),
    )
    .groupBy(aiPrompts.id, aiPrompts.text, aiPrompts.topic, aiPrompts.intent)
    .orderBy(aiPrompts.topic, aiPrompts.text, aiPrompts.id)
    .limit(limit);
  return rows.map((row) => ({ ...row, branded: row.branded === 1 }));
}

/** Per prompt and engine: answers, and those naming, citing and recommending. */
async function engineCounts(
  scope: EvidenceRunScope,
  filters: EvidenceFilters,
  domain: string,
  promptIds: string[],
) {
  if (!promptIds.length) return [];
  return db
    .select({
      promptId: aiObservations.promptId,
      engine: aiObservations.engine,
      answers: sql<number>`count(*)`.mapWith(Number),
      mentions: count(sql`${aiMatches.mentioned}`),
      cited: count(sql`${aiMatches.cited}`),
      recommended: count(sql`${recommendedOf}`),
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .innerJoin(aiMatches, eq(aiMatches.observationId, aiObservations.id))
    .leftJoin(aiPerceptions, perceptionOf)
    .where(
      and(
        answeredFor(scope, filters, domain),
        inArray(aiObservations.promptId, promptIds),
      ),
    )
    .groupBy(aiObservations.promptId, aiObservations.engine)
    .orderBy(aiObservations.engine);
}

/** The newest `perPrompt` answers of each prompt, newest first. */
async function recentAnswers(
  scope: EvidenceRunScope,
  filters: EvidenceFilters,
  domain: string,
  promptIds: string[],
  perPrompt: number,
) {
  if (!promptIds.length) return [];
  const ranked = db
    .select({
      observationId: aiObservations.id,
      promptId: aiObservations.promptId,
      engine: aiObservations.engine,
      runId: aiObservations.runId,
      collectedAt: aiObservations.collectedAt,
      model: aiObservations.model,
      mentioned: aiMatches.mentioned,
      cited: aiMatches.cited,
      recommended: recommendedOf.as("recommended"),
      answerRank:
        sql<number>`row_number() over (partition by ${aiObservations.promptId} order by ${aiObservations.collectedAt} desc nulls last, ${aiObservations.id} desc)`.as(
          "answer_rank",
        ),
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .innerJoin(aiMatches, eq(aiMatches.observationId, aiObservations.id))
    .leftJoin(aiPerceptions, perceptionOf)
    .where(
      and(
        answeredFor(scope, filters, domain),
        inArray(aiObservations.promptId, promptIds),
      ),
    )
    .as("ranked");
  return db
    .select()
    .from(ranked)
    .where(sql`${ranked.answerRank} <= ${perPrompt}`)
    .orderBy(ranked.promptId, sql`${ranked.answerRank}`);
}

/** The newest own-brand domain matched in the scoped runs. */
async function ownDomain(scope: EvidenceRunScope) {
  const rows = await db
    .select({ domain: aiMatches.domain })
    .from(aiMatches)
    .innerJoin(aiObservations, eq(aiObservations.id, aiMatches.observationId))
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .where(and(inScope(scope), eq(aiMatches.own, true)))
    .orderBy(desc(aiRuns.createdAt))
    .limit(1);
  return rows[0]?.domain ?? null;
}

export const AiIntelligenceEvidenceRepository = {
  listPrompts,
  engineCounts,
  recentAnswers,
  ownDomain,
};
