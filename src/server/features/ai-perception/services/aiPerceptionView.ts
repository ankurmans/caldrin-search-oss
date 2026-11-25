import { sort } from "remeda";
import { aiMarketQuery } from "@/shared/ai-market";
import {
  PERCEPTION_CLASSIFIER_VERSION,
  PERCEPTION_READ_ESTIMATE_USD,
  perceptionOutcome,
} from "@/shared/ai-perception";
import type {
  AiPerceptionView,
  PerceptionCellEvidence,
  PerceptionBrandView,
  PerceptionPopulation,
} from "@/shared/ai-perception-view";
import type { AiIntelligenceInput } from "@/types/schemas/ai-visibility-intelligence";
import { AiIntelligenceRepository } from "@/server/features/ai-visibility/repositories/aiIntelligenceRepository";
import { AiMeasurementRepository as measurementRepo } from "@/server/features/ai-visibility/repositories/aiMeasurementRepository";
import {
  metricChange,
  repeatRunLevel,
  repeatRunNote,
  weakerLevel,
} from "@/server/features/ai-visibility/services/aiMeasurementStats";
import {
  applyFilters,
  DAY_MS,
  MAX_RUNS,
  selectIntelRuns,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligence";
import {
  intelCoverage,
  isAnswered,
  type IntelFact,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";
import { AiPerceptionRepository as repo } from "../repositories/AiPerceptionRepository";
import {
  brandPerception,
  compareSentiment,
  perceptionHeatmap,
  readingKey,
  type ReadingIndex,
} from "./perceptionMetrics";

/** Columns of the comparison: your brand and the competitors named most often. */
const MAX_BRANDS = 6;

export async function readingIndex(runIds: string[]): Promise<ReadingIndex> {
  const index: ReadingIndex = new Map();
  for (const p of await repo.listForRuns(runIds, PERCEPTION_CLASSIFIER_VERSION))
    index.set(readingKey(p.observationId, p.domain), {
      stance: p.reviewedStance ?? p.stance,
      sentiment: p.reviewedSentiment ?? p.sentiment,
      reviewed: p.reviewedStance !== null || p.reviewedSentiment !== null,
      ambiguousName: p.ambiguousName,
    });
  return index;
}

function chooseBrands(facts: IntelFact[], competitors: string[] | null) {
  const seen = new Map<
    string,
    { name: string; domain: string; own: boolean; named: number }
  >();
  for (const fact of facts.filter(isAnswered))
    for (const b of fact.brands) {
      const entry = seen.get(b.domain) ?? {
        name: b.name,
        domain: b.domain,
        own: b.own,
        named: 0,
      };
      if (b.mentioned) entry.named += 1;
      seen.set(b.domain, entry);
    }
  const all = [...seen.values()];
  const wanted = (b: { own: boolean; domain: string }) =>
    b.own || !competitors || competitors.includes(b.domain);
  return [
    ...all.filter((b) => b.own),
    ...sort(
      all.filter((b) => !b.own && wanted(b)),
      (a, b) => b.named - a.named || a.name.localeCompare(b.name),
    ),
  ].slice(0, MAX_BRANDS);
}

const none = (reason: string) => ({
  comparable: false,
  reason,
  sentiment: { previous: null, reason },
});

type PerceptionRun = Awaited<
  ReturnType<typeof selectIntelRuns>
>["selectedRuns"][number];

/**
 * Your recommendation share against the previous window of equal length, only
 * when that window ran the same prompt set on the same engines, so a change is
 * never the effect of asking different questions.
 */
async function compareWithPrevious(
  input: AiIntelligenceInput,
  window: { start: string },
  versionId: string | null,
  current: {
    own: PerceptionBrandView | undefined;
    engines: string[];
    runs: number;
    selectedRuns: PerceptionRun[];
    facts: IntelFact[];
    truncated: boolean;
  },
) {
  if (!current.own) return none("No brand of yours is tracked.");
  const previous = {
    from: new Date(
      Date.parse(window.start) - input.days * DAY_MS,
    ).toISOString(),
    to: window.start,
  };
  const previousRuns = await measurementRepo.listFinishedRuns(
    input.projectId,
    previous,
    MAX_RUNS + 1,
    aiMarketQuery(input),
  );
  const runs = previousRuns
    .slice(0, MAX_RUNS)
    .filter(
      (r) => r.promptSetVersionId === versionId && r.createdAt < window.start,
    );
  if (!runs.length)
    return none(
      "The previous period has no runs of this prompt set, so no change is shown.",
    );
  const facts = applyFilters(
    await AiIntelligenceRepository.getFacts(runs.map((r) => r.id)),
    input,
  );
  const coverage = intelCoverage(facts);
  if (coverage.engines.join() !== current.engines.join())
    return none(
      `The previous period answered on ${coverage.engines.length} engine(s) and this one on ${current.engines.length}, so their figures are not compared.`,
    );
  const index = await readingIndex(runs.map((r) => r.id));
  const before = brandPerception(facts, current.own.domain, index);
  if (!before.read)
    return none(
      "The previous period's answers have not been read for perception yet, so no change is shown.",
    );
  const level = weakerLevel(
    repeatRunLevel(coverage.contributingRuns),
    repeatRunLevel(current.runs),
  );
  const result = metricChange(
    before.recommendedOfAnswers,
    current.own.recommendedOfAnswers,
    level,
  );
  const sentiment = !versionId
    ? {
        previous: null,
        reason: "These runs don’t have a saved prompt set to compare.",
      }
    : current.truncated || previousRuns.length > MAX_RUNS
      ? {
          previous: null,
          reason:
            "Choose a shorter date range to compare all runs in both periods.",
        }
      : Math.min(coverage.contributingRuns, current.runs) < 2
        ? {
            previous: null,
            reason: "Each period needs at least two runs with saved answers.",
          }
        : compareSentiment(
            before,
            current.own,
            previous,
            { facts, runs },
            { facts: current.facts, runs: current.selectedRuns },
          );
  return {
    comparable: true,
    reason: null,
    sentiment,
    change: {
      previous: before.recommendedOfAnswers,
      difference: result.difference,
      verdict: result.verdict,
    },
  };
}

/** Who and what a figure covers: window, prompt set, engines, runs and gaps. */
export function populationFor(
  input: AiIntelligenceInput,
  selected: {
    window: { start: string; end: string };
    selectedVersionId: string | null;
  },
  facts: IntelFact[],
): PerceptionPopulation {
  const coverage = intelCoverage(facts);
  const level = repeatRunLevel(coverage.contributingRuns);
  return {
    window: { ...selected.window, days: input.days },
    promptSetVersionId: selected.selectedVersionId,
    prompts: coverage.prompts,
    engines: coverage.engines,
    runs: coverage.contributingRuns,
    planned: coverage.planned,
    answered: coverage.answered,
    missing: coverage.planned - coverage.answered,
    repeatRuns: {
      runCount: coverage.contributingRuns,
      level,
      note: repeatRunNote(level),
    },
    classifierVersion: PERCEPTION_CLASSIFIER_VERSION,
  };
}

/**
 * How AI answers treat each brand over one prompt set and window. It reads the
 * same runs and filters as Visibility Insights, so the two pages count the same
 * answers, and every rate carries its numerator and denominator.
 */
export async function loadPerceptionView(
  input: AiIntelligenceInput,
): Promise<AiPerceptionView> {
  const { window, selectedVersionId, selectedRuns, truncated } =
    await selectIntelRuns(input);
  const facts = applyFilters(
    await AiIntelligenceRepository.getFacts(selectedRuns.map((r) => r.id)),
    input,
  );
  const index = await readingIndex(selectedRuns.map((r) => r.id));
  const coverage = intelCoverage(facts);
  const chosen = chooseBrands(facts, input.competitors ?? null);
  const brands: PerceptionBrandView[] = chosen.map((b) => ({
    name: b.name,
    own: b.own,
    change: null,
    ...brandPerception(facts, b.domain, index),
  }));
  const own = brands.find((b) => b.own);
  const comparison = await compareWithPrevious(
    input,
    window,
    selectedVersionId,
    {
      own,
      engines: coverage.engines,
      runs: coverage.contributingRuns,
      selectedRuns,
      facts,
      truncated,
    },
  );
  if (own && "change" in comparison) own.change = comparison.change;
  const { heatmap, topics } = perceptionHeatmap(
    facts,
    chosen.map((b) => b.domain),
    index,
  );
  const unreadFacts = facts.filter(
    (f) =>
      isAnswered(f) &&
      f.brands.some(
        (b) => b.mentioned && !index.has(readingKey(f.id, b.domain)),
      ),
  );
  const warnings =
    coverage.answered === 0
      ? ["No answers with text in this window, so there is nothing to read."]
      : [];
  return {
    population: populationFor(input, { window, selectedVersionId }, facts),
    brands,
    topics,
    heatmap,
    unread: {
      answers: unreadFacts.length,
      runIds: selectedRuns
        .map((r) => r.id)
        .filter((id) => unreadFacts.some((f) => f.runId === id)),
      estimateUsd: +(unreadFacts.length * PERCEPTION_READ_ESTIMATE_USD).toFixed(
        4,
      ),
    },
    comparison: {
      comparable: comparison.comparable,
      reason: comparison.reason,
    },
    sentimentComparison: comparison.sentiment,
    warnings,
  };
}

/** One brand's reading in each of the given answers, newest first. */
export async function answersFor(facts: IntelFact[], domain: string) {
  const stored = await repo.listForObservations(
    facts.map((f) => f.id),
    PERCEPTION_CLASSIFIER_VERSION,
  );
  const readings = new Map(
    stored.filter((p) => p.domain === domain).map((p) => [p.observationId, p]),
  );
  const brand =
    facts.flatMap((f) => f.brands).find((b) => b.domain === domain) ?? null;
  const answers = facts.flatMap((fact) => {
    const match = fact.brands.find((b) => b.domain === domain);
    if (!match) return [];
    const p = readings.get(fact.id);
    const stance = p ? (p.reviewedStance ?? p.stance) : null;
    const sentiment = p ? (p.reviewedSentiment ?? p.sentiment) : null;
    return [
      {
        observationId: fact.id,
        engine: fact.engine,
        collectedAt: fact.collectedAt,
        model: fact.model,
        outcome: perceptionOutcome(
          match.mentioned,
          stance && sentiment ? { stance, sentiment } : null,
        ),
        reading:
          p && stance && sentiment
            ? {
                id: p.id,
                stance,
                sentiment,
                reviewed:
                  p.reviewedStance !== null || p.reviewedSentiment !== null,
                confidence: p.confidence,
                evidence: p.evidence,
                ambiguousName: p.ambiguousName,
                strengths: p.points
                  .filter((x) => x.kind === "strength")
                  .map((x) => x.text),
                weaknesses: p.points
                  .filter((x) => x.kind === "weakness")
                  .map((x) => x.text),
                objections: p.points
                  .filter((x) => x.kind === "objection")
                  .map((x) => x.text),
                comparisons: p.comparisons.map((c) => ({
                  competitor: c.competitorName,
                  outcome: c.outcome,
                })),
              }
            : null,
      },
    ];
  });
  return {
    brand: brand ? { name: brand.name, domain: brand.domain } : null,
    answers: sort(answers, (a, b) =>
      (b.collectedAt ?? "").localeCompare(a.collectedAt ?? ""),
    ),
  };
}

/** The answers behind one heatmap cell, each with its reading and evidence. */
export async function loadPerceptionCell(
  input: AiIntelligenceInput & {
    domain: string;
    promptId?: string | null;
    topic?: string | null;
  },
): Promise<PerceptionCellEvidence> {
  const { selectedRuns } = await selectIntelRuns(input);
  const facts = applyFilters(
    await AiIntelligenceRepository.getFacts(selectedRuns.map((r) => r.id)),
    input,
  ).filter(
    (f) =>
      isAnswered(f) &&
      (input.promptId
        ? f.promptId === input.promptId
        : input.topic
          ? f.topic === input.topic
          : false),
  );
  const { answers, brand } = await answersFor(facts, input.domain);
  return {
    promptId: input.promptId ?? null,
    topic: facts[0]?.topic ?? input.topic ?? null,
    prompt: input.promptId ? (facts[0]?.prompt ?? null) : null,
    brand,
    answers,
  };
}
