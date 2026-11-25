import { AiVisibilityRepository as visibility } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { AiPerceptionRepository as repo } from "../repositories/AiPerceptionRepository";
import { AppError } from "@/server/lib/errors";
import { PERCEPTION_CLASSIFIER_VERSION } from "@/shared/ai-perception";
import type { z } from "zod";
import type { getAiPerceptionSchema } from "@/types/schemas/ai-perception";

async function resolveRun(projectId: string, runId?: string) {
  if (runId) return visibility.getRun(projectId, runId);
  return (
    (await visibility.listRuns(projectId, 10)).find(
      (r) => r.status === "completed" || r.status === "partial",
    ) ?? null
  );
}

/**
 * The saved readings of one run, each with the words in the answer it rests
 * on. A person's correction, when there is one, is the value shown and the
 * model's own reading stays beside it.
 */
export async function listPerceptionReadings(
  input: z.infer<typeof getAiPerceptionSchema>,
) {
  const run = await resolveRun(input.projectId, input.runId);
  if (input.runId && !run) throw new AppError("NOT_FOUND");
  const observations = run ? await visibility.getObservations([run.id]) : [];
  const byId = new Map(observations.map((o) => [o.id, o]));
  const saved = await repo.listForObservations(
    observations.map((o) => o.id),
    PERCEPTION_CLASSIFIER_VERSION,
  );
  const readings = saved
    .map((p) => ({
      p,
      stance: p.reviewedStance ?? p.stance,
      sentiment: p.reviewedSentiment ?? p.sentiment,
    }))
    .filter(
      ({ p, stance, sentiment }) =>
        (input.brand === "all" || p.own === (input.brand === "own")) &&
        (!input.stance || stance === input.stance) &&
        (!input.sentiment || sentiment === input.sentiment),
    );
  const named = new Set(
    (await visibility.getEvidence(observations.map((o) => o.id))).matches
      .filter((m) => m.mentioned)
      .map((m) => `${m.observationId}:${m.domain}`),
  );
  return {
    runId: run?.id ?? null,
    classifierVersion: PERCEPTION_CLASSIFIER_VERSION,
    answersWithText: observations.filter(
      (o) => o.status === "completed" && o.answerMarkdown,
    ).length,
    brandMentions: named.size,
    readings: readings.slice(0, input.limit).map(({ p, stance, sentiment }) => {
      const answer = byId.get(p.observationId);
      return {
        id: p.id,
        observationId: p.observationId,
        engine: answer?.engine ?? null,
        answerModel: answer?.model ?? null,
        prompt: answer?.prompt ?? null,
        collectedAt: answer?.collectedAt ?? null,
        brand: p.name,
        domain: p.domain,
        own: p.own,
        stance,
        sentiment,
        confidence: p.confidence,
        evidence: p.evidence,
        ambiguousName: p.ambiguousName,
        reviewed: p.reviewedStance !== null || p.reviewedSentiment !== null,
        modelReading: { stance: p.stance, sentiment: p.sentiment },
        classifier: { model: p.model, classifiedAt: p.classifiedAt },
        strengths: p.points.filter((x) => x.kind === "strength"),
        weaknesses: p.points.filter((x) => x.kind === "weakness"),
        objections: p.points.filter((x) => x.kind === "objection"),
        comparisons: p.comparisons.map((c) => ({
          competitor: c.competitorName,
          domain: c.competitorDomain,
          outcome: c.outcome,
        })),
      };
    }),
    totalReadings: readings.length,
    notes: [
      "A reading is a small model's interpretation of one saved answer, checked against the answer text. Open the answer with get_ai_visibility_answer before acting on it.",
      "Stance is what the answer tells a buyer to do (recommended, described, discouraged). Sentiment is the tone toward the brand. They are separate on purpose.",
      "Mentions without a reading yet: run classify_ai_visibility_sentiment for this run.",
    ],
  };
}
