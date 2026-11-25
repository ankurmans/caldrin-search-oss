import { mapToObj, sort, unique } from "remeda";
import {
  PERCEPTION_OUTCOMES,
  PERCEPTION_SENTIMENTS,
  PERCEPTION_STANCES,
  perceptionOutcome,
  type PerceptionOutcome,
  type PerceptionSentiment,
  type PerceptionStance,
} from "@/shared/ai-perception";
import type {
  PerceptionBrandView,
  PerceptionHeatmapCell,
  PerceptionHeatmapRow,
  PerceptionSentimentComparison,
  PerceptionTopicRow,
} from "@/shared/ai-perception-view";
import { toRate } from "@/server/features/ai-visibility/services/aiMeasurementStats";
import {
  groupInto,
  isAnswered,
  type IntelFact,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";

/** The value in force for one brand in one answer: a correction, else the model's. */
export interface EffectiveReading {
  stance: PerceptionStance;
  sentiment: PerceptionSentiment;
  reviewed: boolean;
  ambiguousName: boolean;
}

export type ReadingIndex = Map<string, EffectiveReading>;
export const readingKey = (observationId: string, domain: string) =>
  `${observationId}:${domain}`;

export const zeroCounts = (): Record<PerceptionOutcome, number> =>
  mapToObj(PERCEPTION_OUTCOMES, (o) => [o, 0]);

/** The outcome of one answer for one brand; null when the brand was not tracked. */
export function outcomeOf(
  fact: IntelFact,
  domain: string,
  readings: ReadingIndex,
): PerceptionOutcome | null {
  const match = fact.brands.find((b) => b.domain === domain);
  if (!match) return null;
  return perceptionOutcome(
    match.mentioned,
    readings.get(readingKey(fact.id, domain)) ?? null,
  );
}

/** The brand's figures over the answered collections in which it was tracked. */
export function brandPerception(
  facts: IntelFact[],
  domain: string,
  readings: ReadingIndex,
): Omit<PerceptionBrandView, "name" | "own" | "change"> {
  const answered = facts.filter(
    (f) => isAnswered(f) && f.brands.some((b) => b.domain === domain),
  );
  const named = answered.filter(
    (f) => f.brands.find((b) => b.domain === domain)?.mentioned,
  );
  const read = named
    .map((f) => readings.get(readingKey(f.id, domain)))
    .filter((r) => r !== undefined);
  const stance = mapToObj(PERCEPTION_STANCES, (s) => [
    s,
    read.filter((r) => r.stance === s).length,
  ]);
  const sentiment = mapToObj(PERCEPTION_SENTIMENTS, (s) => [
    s,
    read.filter((r) => r.sentiment === s).length,
  ]);
  return {
    domain,
    mention: toRate(named.length, answered.length),
    cited: toRate(
      answered.filter((f) => f.brands.find((b) => b.domain === domain)?.cited)
        .length,
      answered.length,
    ),
    read: read.length,
    unread: named.length - read.length,
    recommendedOfMentions: toRate(stance.recommended, read.length),
    discouragedOfMentions: toRate(stance.discouraged, read.length),
    recommendedOfAnswers: toRate(stance.recommended, answered.length),
    sentiment,
    stance,
    corrected: read.filter((r) => r.reviewed).length,
    ambiguous: read.filter((r) => r.ambiguousName).length,
  };
}

type PerceptionSample = {
  facts: IntelFact[];
  runs: { id: string; locationCode: number; languageCode: string }[];
};

function answerMix({ facts, runs }: PerceptionSample, domain: string) {
  const markets = new Map(
    runs.map((r) => [r.id, `${r.locationCode}:${r.languageCode}`]),
  );
  return groupInto(
    facts.filter(
      (fact) =>
        isAnswered(fact) && fact.brands.some((b) => b.domain === domain),
    ),
    (fact) =>
      JSON.stringify([fact.promptId, fact.engine, markets.get(fact.runId)]),
  );
}

const noSentiment = (reason: string) => ({ previous: null, reason });

export function compareSentiment(
  before: ReturnType<typeof brandPerception>,
  own: PerceptionBrandView,
  previous: { from: string; to: string },
  previousSample: PerceptionSample,
  currentSample: PerceptionSample,
): PerceptionSentimentComparison {
  if (!own.read)
    return noSentiment(
      "No mentions of your brand have a reading in this period.",
    );
  if (own.unread || before.unread)
    return noSentiment("Some mentions of your brand still need a reading.");
  const beforeMix = answerMix(previousSample, own.domain);
  const currentMix = answerMix(currentSample, own.domain);
  // Compare proportions so a period with more repeats can still match.
  if (
    beforeMix.size !== currentMix.size ||
    [...beforeMix].some(
      ([key, answers]) =>
        answers.length * own.mention.denominator !==
        (currentMix.get(key)?.length ?? 0) * before.mention.denominator,
    )
  )
    return noSentiment(
      "The two periods sampled different mixes of prompts, engines or markets.",
    );

  return {
    previous: {
      start: previous.from,
      end: previous.to,
      counts: before.sentiment,
    },
    reason: null,
  };
}

function cellFor(
  facts: IntelFact[],
  domain: string,
  readings: ReadingIndex,
): PerceptionHeatmapCell {
  const counts = zeroCounts();
  let answers = 0;
  for (const fact of facts) {
    if (!isAnswered(fact)) continue;
    const outcome = outcomeOf(fact, domain, readings);
    if (!outcome) continue;
    counts[outcome] += 1;
    answers += 1;
  }
  return { domain, counts, answers };
}

/** One row per prompt, one cell per brand, over every answer in scope. */
export function perceptionHeatmap(
  facts: IntelFact[],
  domains: string[],
  readings: ReadingIndex,
): { heatmap: PerceptionHeatmapRow[]; topics: PerceptionTopicRow[] } {
  const byPrompt = groupInto(facts, (f) => f.promptId);
  const heatmap = sort(
    [...byPrompt.values()].map((group) => ({
      promptId: group[0].promptId,
      prompt: group[0].prompt,
      topic: group[0].topic,
      intent: group[0].intent,
      cells: domains.map((d) => cellFor(group, d, readings)),
    })),
    (a, b) =>
      a.topic.localeCompare(b.topic) || a.prompt.localeCompare(b.prompt),
  );
  const topics = [...groupInto(heatmap, (r) => r.topic)].map(
    ([topic, rows]) => ({
      topic,
      prompts: unique(rows.map((r) => r.promptId)).length,
      cells: domains.map((domain) => {
        const counts = zeroCounts();
        let answers = 0;
        for (const row of rows) {
          const cell = row.cells.find((c) => c.domain === domain);
          if (!cell) continue;
          for (const o of PERCEPTION_OUTCOMES) counts[o] += cell.counts[o];
          answers += cell.answers;
        }
        return { domain, counts, answers };
      }),
    }),
  );
  return { heatmap, topics };
}
