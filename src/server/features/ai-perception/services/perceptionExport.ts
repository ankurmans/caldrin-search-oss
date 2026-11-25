import { sort } from "remeda";
import { PERCEPTION_CLASSIFIER_VERSION } from "@/shared/ai-perception";
import {
  applyFilters,
  selectIntelRuns,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligence";
import { isAnswered } from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";
import { AiIntelligenceRepository } from "@/server/features/ai-visibility/repositories/aiIntelligenceRepository";
import type { AiIntelligenceInput } from "@/types/schemas/ai-visibility-intelligence";
import { AiPerceptionRepository } from "../repositories/AiPerceptionRepository";

const MAX_EXPORT_ROWS = 5_000;

export async function loadPerceptionExport(
  input: AiIntelligenceInput & { domain: string },
) {
  const { selectedRuns, selectedVersionId, window, truncated } =
    await selectIntelRuns(input);
  const runIds = selectedRuns.map((run) => run.id);
  const facts = applyFilters(
    await AiIntelligenceRepository.getFacts(runIds),
    input,
  );
  const matches = facts.flatMap((fact) => {
    if (!isAnswered(fact)) return [];
    const brand = fact.brands.find((match) => match.domain === input.domain);
    if (
      !brand ||
      (!brand.own &&
        input.competitors &&
        !input.competitors.includes(brand.domain))
    )
      return [];
    return [{ fact, brand }];
  });
  const sample = sort(
    matches,
    (a, b) =>
      (b.fact.collectedAt ?? "").localeCompare(a.fact.collectedAt ?? "") ||
      a.fact.id.localeCompare(b.fact.id),
  ).slice(0, MAX_EXPORT_ROWS);
  const runs = new Map(selectedRuns.map((run) => [run.id, run]));
  const readings = new Map(
    (sample.length
      ? await AiPerceptionRepository.listForRuns(
          [...new Set(sample.map(({ fact }) => fact.runId))],
          PERCEPTION_CLASSIFIER_VERSION,
          input.domain,
        )
      : []
    ).map((reading) => [reading.observationId, reading]),
  );
  return {
    promptSetVersionId: selectedVersionId,
    classifierVersion: PERCEPTION_CLASSIFIER_VERSION,
    window,
    truncated: truncated || matches.length > MAX_EXPORT_ROWS,
    rows: sample.map(({ fact, brand }) => {
      const run = runs.get(fact.runId);
      const reading = brand.mentioned ? readings.get(fact.id) : undefined;
      return {
        answerId: fact.id,
        brand: brand.name,
        domain: brand.domain,
        prompt: fact.prompt,
        engine: fact.engine,
        model: fact.model,
        locationCode: run?.locationCode,
        languageCode: run?.languageCode,
        collectedAt: fact.collectedAt,
        status: reading ? "Read" : brand.mentioned ? "Unread" : "Not named",
        stance: reading?.reviewedStance ?? reading?.stance ?? null,
        sentiment: reading?.reviewedSentiment ?? reading?.sentiment ?? null,
        evidence: reading?.evidence ?? null,
        corrected: reading
          ? reading.reviewedStance !== null ||
            reading.reviewedSentiment !== null
          : null,
      };
    }),
  };
}
