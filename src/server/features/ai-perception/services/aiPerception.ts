import { AiVisibilityRepository as visibility } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import {
  AiPerceptionRepository as repo,
  type PerceptionToSave,
} from "../repositories/AiPerceptionRepository";
import { readAnswerPerception } from "./perceptionReading";
import {
  recordResearchSpend,
  withResearchAdmission,
} from "@/server/features/workspace/researchSpend";
import { requireOpenRouterAccess } from "@/server/lib/openrouter";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import type { CustomerContext } from "@/server/lib/customer-context";
import {
  PERCEPTION_CLASSIFIER_VERSION,
  type PerceptionSentiment,
  type PerceptionStance,
} from "@/shared/ai-perception";

/** Answers read per call, so one request has a bounded cost. */
const ANSWER_LIMIT = 40;
const CONCURRENCY = 4;

type PerceptionRunResult = {
  runId: string;
  classifierVersion: string;
  answersRead: number;
  readingsSaved: number;
  /** Answers still without a reading after this call (more than the limit). */
  remaining: number;
  costUsd: number;
};

/**
 * Reads how each answer of one run treats the brands it names. Only answers
 * that carry text and name a brand are read, and only brands without a reading
 * from this classifier version, so a repeat call on a finished run is free.
 * Citation-only and empty answers are never given a perception.
 */
export async function classifyRunPerception(
  input: { projectId: string; runId: string },
  customer: CustomerContext,
): Promise<PerceptionRunResult> {
  const run = await visibility.getRun(input.projectId, input.runId);
  if (!run) throw new AppError("NOT_FOUND");
  const observations = (await visibility.getObservations([run.id])).filter(
    (o) => o.status === "completed" && o.answerMarkdown,
  );
  const ids = observations.map((o) => o.id);
  const [{ matches }, done] = await Promise.all([
    visibility.getEvidence(ids),
    repo.listForObservations(ids, PERCEPTION_CLASSIFIER_VERSION),
  ]);
  const read = new Set(done.map((d) => `${d.observationId}:${d.domain}`));
  const pending = observations
    .map((observation) => {
      const named = matches.filter(
        (m) => m.observationId === observation.id && m.mentioned,
      );
      return {
        observation,
        named,
        todo: named.filter((m) => !read.has(`${observation.id}:${m.domain}`)),
      };
    })
    .filter((entry) => entry.todo.length);
  const result: PerceptionRunResult = {
    runId: run.id,
    classifierVersion: PERCEPTION_CLASSIFIER_VERSION,
    answersRead: 0,
    readingsSaved: 0,
    remaining: 0,
    costUsd: 0,
  };
  const batch = pending.slice(0, ANSWER_LIMIT);
  if (!batch.length) return result;

  const access = await requireOpenRouterAccess();
  const modelId = await getOptionalEnvValue("OPENROUTER_MODEL");

  await withResearchAdmission(customer, async () => {
    const queue = [...batch];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const text = next.observation.answerMarkdown ?? "";
        // Every named brand goes in so comparisons can refer to any of them,
        // but only brands without a reading are saved.
        const reading = await readAnswerPerception({
          access,
          modelId,
          text,
          brands: next.named,
        }).catch((error: unknown) => {
          console.error("Perception reading failed", {
            observationId: next.observation.id,
            error,
          });
          return null;
        });
        if (!reading) continue;
        result.costUsd += reading.costUsd;
        result.answersRead += 1;
        const wanted = new Set(next.todo.map((m) => m.domain.toLowerCase()));
        const classifiedAt = new Date().toISOString();
        for (const r of reading.readings) {
          if (!wanted.has(r.domain.toLowerCase())) continue;
          const id = crypto.randomUUID();
          const item: PerceptionToSave = {
            perception: {
              id,
              observationId: next.observation.id,
              domain: r.domain,
              name: r.name,
              own: r.own,
              stance: r.stance,
              sentiment: r.sentiment,
              confidence: r.confidence,
              evidence: r.evidence,
              ambiguousName: r.ambiguousName,
              classifierVersion: PERCEPTION_CLASSIFIER_VERSION,
              model: reading.model,
              classifiedAt,
            },
            points: r.points.map((p) => ({
              id: crypto.randomUUID(),
              kind: p.kind,
              text: p.text,
              quote: p.quote,
            })),
            comparisons: r.comparisons.map((c) => ({
              id: crypto.randomUUID(),
              competitorDomain: c.competitorDomain,
              competitorName: c.competitorName,
              outcome: c.outcome,
            })),
          };
          await repo.save(item);
          result.readingsSaved += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  });
  await recordResearchSpend({ ...customer, projectId: input.projectId }, [
    {
      provider: "openrouter",
      operation: "ai_perception",
      costUsd: result.costUsd,
    },
  ]);
  return { ...result, remaining: Math.max(0, pending.length - batch.length) };
}

/**
 * A person's correction to one reading. The model's reading stays; the
 * correction and every change to it are recorded.
 */
export async function reviewPerception(
  input: {
    projectId: string;
    perceptionId: string;
    stance?: PerceptionStance;
    sentiment?: PerceptionSentiment;
    note?: string;
  },
  userId: string | null,
) {
  const perception = await repo.getForProject(
    input.projectId,
    input.perceptionId,
  );
  if (!perception) throw new AppError("NOT_FOUND");
  const stance = input.stance ?? perception.reviewedStance ?? perception.stance;
  const sentiment =
    input.sentiment ?? perception.reviewedSentiment ?? perception.sentiment;
  const reviewedAt = new Date().toISOString();
  const entries = [
    {
      field: "stance" as const,
      from: perception.reviewedStance ?? perception.stance,
      to: stance,
    },
    {
      field: "sentiment" as const,
      from: perception.reviewedSentiment ?? perception.sentiment,
      to: sentiment,
    },
  ]
    .filter((e) => e.from !== e.to)
    .map((e) => ({
      id: crypto.randomUUID(),
      field: e.field,
      fromValue: e.from,
      toValue: e.to,
      note: input.note ?? null,
      reviewedBy: userId,
      reviewedAt,
    }));
  if (!entries.length)
    throw new AppError(
      "VALIDATION_ERROR",
      "That is already the saved reading.",
    );
  await repo.review({
    perception,
    reviewedStance: stance,
    reviewedSentiment: sentiment,
    entries,
    matchSentimentModel: "reviewed by a person",
  });
  return { id: perception.id, stance, sentiment };
}
