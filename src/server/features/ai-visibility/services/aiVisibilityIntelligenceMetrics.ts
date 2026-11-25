import { sort, unique } from "remeda";
import type { AiEngine } from "@/shared/ai-visibility";
import type { AiPromptIntent } from "@/shared/ai-prompt-intent";
import type {
  IntelBrand,
  IntelCollectionPoint,
  IntelCoverage,
  IntelEngineVisibility,
} from "@/shared/ai-visibility-intelligence";
import { toRate } from "./aiMeasurementStats";

export interface IntelMatch {
  name: string;
  domain: string;
  own: boolean;
  mentioned: boolean;
  cited: boolean;
  recommended: boolean | null;
  firstMention: number | null;
  sentiment?: "positive" | "neutral" | "negative" | "mixed" | null;
}

/** One planned collection (prompt × engine × run) with every brand's result. */
export interface IntelFact {
  id: string;
  runId: string;
  promptId: string;
  prompt: string;
  topic: string;
  intent: AiPromptIntent | null;
  branded: boolean;
  engine: AiEngine;
  status: "pending" | "completed" | "failed";
  hasAnswer: boolean;
  model: string | null;
  collectedAt: string | null;
  brands: IntelMatch[];
}

/** Items grouped by key, in first-seen order. */
export function groupInto<T, K extends string>(
  items: T[],
  key: (item: T) => K,
) {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

export const isAnswered = (fact: IntelFact) =>
  fact.status === "completed" && fact.hasAnswer;

export function intelCoverage(facts: IntelFact[]): IntelCoverage {
  const answered = facts.filter(isAnswered);
  return {
    runs: unique(facts.map((f) => f.runId)).length,
    contributingRuns: unique(answered.map((f) => f.runId)).length,
    planned: facts.length,
    answered: answered.length,
    noAnswer: facts.filter((f) => f.status === "completed" && !f.hasAnswer)
      .length,
    failed: facts.filter((f) => f.status === "failed").length,
    pending: facts.filter((f) => f.status === "pending").length,
    prompts: unique(answered.map((f) => f.promptId)).length,
    engines: sort(unique(answered.map((f) => f.engine)), (a, b) =>
      a.localeCompare(b),
    ),
  };
}

function sentimentSummary(mentioned: IntelMatch[]): IntelBrand["sentiment"] {
  const labeled = mentioned.filter((m) => m.sentiment);
  if (!labeled.length) return null;
  const count = (label: NonNullable<IntelMatch["sentiment"]>) =>
    labeled.filter((m) => m.sentiment === label).length;
  return {
    classified: labeled.length,
    mentioned: mentioned.length,
    positive: count("positive"),
    neutral: count("neutral"),
    negative: count("negative"),
    mixed: count("mixed"),
  };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/**
 * Per engine, the mean over prompts of (answers naming the brand / answers),
 * then the mean of those engine figures with equal weight. Answers where the
 * brand was not tracked are not counted for it at all.
 */
function engineVisibility(
  rows: { engine: AiEngine; promptId: string; mentioned: boolean }[],
): { overall: number | null; byEngine: IntelEngineVisibility[] } {
  const byEngine = [...groupInto(rows, (r) => r.engine)].map(
    ([engine, engineRows]) => {
      const promptRates = [
        ...groupInto(engineRows, (r) => r.promptId).values(),
      ].map((p) => p.filter((r) => r.mentioned).length / p.length);
      return {
        engine,
        visibility: mean(promptRates),
        prompts: promptRates.length,
        answers: engineRows.length,
        mentions: engineRows.filter((r) => r.mentioned).length,
      };
    },
  );
  const sorted = sort(byEngine, (a, b) => a.engine.localeCompare(b.engine));
  return {
    overall: mean(sorted.flatMap((e) => e.visibility ?? [])),
    byEngine: sorted,
  };
}

/** Visibility of one brand over a set of facts, for trend points. */
export function brandVisibility(facts: IntelFact[], domain: string) {
  return engineVisibility(rowsFor(facts.filter(isAnswered), domain));
}

/**
 * One point per UTC collection day and prompt set: every run of that set
 * created that day is pooled, so a day with a retry or a manual check counts
 * once. Points of different prompt sets are never merged, even on the same
 * day. `facts` are the in-scope facts of the given runs.
 */
export function collectionTrend(
  runs: { id: string; createdAt: string; promptSetVersionId: string | null }[],
  facts: IntelFact[],
  domain: string | null,
): IntelCollectionPoint[] {
  const byRun = groupInto(facts, (f) => f.runId);
  const ordered = sort(runs, (a, b) => a.createdAt.localeCompare(b.createdAt));
  const groups = groupInto(
    ordered,
    (r) => `${r.createdAt.slice(0, 10)}|${r.promptSetVersionId ?? ""}`,
  );
  return [...groups.values()].map((group) => {
    const answered = group
      .flatMap((r) => byRun.get(r.id) ?? [])
      .filter(isAnswered);
    const rows = domain ? rowsFor(answered, domain) : [];
    return {
      date: group[0].createdAt.slice(0, 10),
      promptSetVersionId: group[0].promptSetVersionId,
      runs: group.length,
      visibility: engineVisibility(rows).overall,
      mention: toRate(rows.filter((r) => r.mentioned).length, rows.length),
      prompts: unique(answered.map((f) => f.promptId)).length,
      engines: sort(unique(answered.map((f) => f.engine)), (a, b) =>
        a.localeCompare(b),
      ),
    };
  });
}

function rowsFor(answered: IntelFact[], domain: string) {
  return answered.flatMap((fact) => {
    const match = fact.brands.find((b) => b.domain === domain);
    return match
      ? [{ engine: fact.engine, promptId: fact.promptId, ...match }]
      : [];
  });
}

/** Rank of each compared brand by first mention, in one answer. */
function mentionRanks(fact: IntelFact, compared: Set<string>) {
  const named = sort(
    fact.brands.filter(
      (b) => compared.has(b.domain) && b.mentioned && b.firstMention !== null,
    ),
    (a, b) => (a.firstMention ?? 0) - (b.firstMention ?? 0),
  );
  return new Map(named.map((b, index) => [b.domain, index + 1]));
}

/** Standard competition ranking by visibility: ties share a rank, nulls get none. */
function rankBrands(brands: IntelBrand[]) {
  const ranked = sort(
    brands.filter((b) => b.visibility !== null),
    (a, b) => (b.visibility ?? 0) - (a.visibility ?? 0),
  );
  for (const brand of brands) {
    brand.rank =
      brand.visibility === null
        ? null
        : ranked.findIndex((b) => b.visibility === brand.visibility) + 1;
  }
}

/**
 * Every metric for each compared brand over the answered facts in scope. The
 * own brand is always compared; `competitors` narrows the others.
 */
export function computeBrands(
  facts: IntelFact[],
  competitors: string[] | null,
): IntelBrand[] {
  const answered = facts.filter(isAnswered);
  const known = new Map<string, IntelMatch>();
  for (const fact of answered)
    for (const brand of fact.brands)
      if (!known.has(brand.domain)) known.set(brand.domain, brand);
  const compared = new Set(
    [...known.values()]
      .filter((b) => b.own || !competitors || competitors.includes(b.domain))
      .map((b) => b.domain),
  );
  const ranks = answered.map((fact) => mentionRanks(fact, compared));
  const totalMentions = answered.reduce(
    (sum, fact) =>
      sum +
      fact.brands.filter((b) => compared.has(b.domain) && b.mentioned).length,
    0,
  );
  const brands = [...compared].map((domain): IntelBrand => {
    const first = known.get(domain)!;
    const rows = rowsFor(answered, domain);
    const mentioned = rows.filter((r) => r.mentioned);
    const positions = ranks.flatMap((r) => r.get(domain) ?? []);
    const { overall, byEngine } = engineVisibility(rows);
    return {
      name: first.name || domain,
      domain,
      own: first.own,
      answers: rows.length,
      prompts: unique(rows.map((r) => r.promptId)).length,
      visibility: overall,
      enginesCounted: byEngine.map((e) => e.engine),
      mention: toRate(mentioned.length, rows.length),
      shareOfVoice: toRate(mentioned.length, totalMentions),
      avgPosition: { value: mean(positions), answers: positions.length },
      citationAmongMentioned: toRate(
        mentioned.filter((r) => r.cited).length,
        mentioned.length,
      ),
      citedAnswers: toRate(rows.filter((r) => r.cited).length, rows.length),
      recommendation: toRate(
        mentioned.filter((r) => r.recommended === true).length,
        mentioned.length,
      ),
      notRecommended: rows.filter((r) => r.recommended === false).length,
      byEngine,
      rank: null,
      change: null,
      sentiment: sentimentSummary(mentioned),
    };
  });
  rankBrands(brands);
  return sort(
    brands,
    (a, b) =>
      (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
      Number(b.own) - Number(a.own) ||
      a.name.localeCompare(b.name),
  );
}
