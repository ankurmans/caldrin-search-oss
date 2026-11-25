import type { AiEngine } from "./ai-visibility";
import type { AiPromptIntent } from "./ai-prompt-intent";

/** A count over its denominator. `rate` is null when the denominator is 0. */
export interface IntelRate {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface IntelEngineVisibility {
  engine: AiEngine;
  /** Mean of per-prompt hit rates on this engine; null with no answers. */
  visibility: number | null;
  prompts: number;
  answers: number;
  mentions: number;
}

export interface IntelBrandChange {
  /** Visibility points, current minus previous window. */
  difference: number | null;
  previousVisibility: number | null;
  /** From the pooled mention rate, with the repeat-run floor applied. */
  verdict:
    | "outside_noise"
    | "within_noise"
    | "insufficient_runs"
    | "not_assessable";
}

export interface IntelBrand {
  name: string;
  domain: string;
  own: boolean;
  /** Answered collections in which this brand was tracked. */
  answers: number;
  prompts: number;
  visibility: number | null;
  /** Engines that had answers for this brand and entered the mean. */
  enginesCounted: AiEngine[];
  /** Unweighted: answers naming the brand / answers. */
  mention: IntelRate;
  /** Answers naming the brand / answers naming any compared brand, counted per brand. */
  shareOfVoice: IntelRate;
  /** Mean rank of first mention among compared brands named in the same answer. */
  avgPosition: { value: number | null; answers: number };
  /** Answers naming AND citing the brand's site / answers naming it. */
  citationAmongMentioned: IntelRate;
  /** Answers citing the brand's site / all answers. */
  citedAnswers: IntelRate;
  /** Answers with explicit recommendation language / answers naming it. */
  recommendation: IntelRate;
  /** Answers with explicit negative recommendation language. */
  notRecommended: number;
  byEngine: IntelEngineVisibility[];
  rank: number | null;
  change: IntelBrandChange | null;
  /**
   * Classified sentiment of answers naming the brand, counted over the
   * mentions that have a label; null when none has one yet.
   */
  sentiment: {
    classified: number;
    mentioned: number;
    positive: number;
    neutral: number;
    negative: number;
    mixed: number;
  } | null;
}

export interface IntelCoverage {
  runs: number;
  /** Runs that produced at least one answer in scope. */
  contributingRuns: number;
  planned: number;
  answered: number;
  noAnswer: number;
  failed: number;
  pending: number;
  prompts: number;
  engines: AiEngine[];
}

export interface IntelTrendPoint {
  runId: string;
  at: string;
  promptSetVersionId: string | null;
  visibility: number | null;
  answers: number;
  byEngine: { engine: AiEngine; visibility: number | null }[];
}

/**
 * Runs of one prompt set collected on the same UTC day, pooled. The rate uses
 * the scorecard's equal-engine visibility formula over the pooled answers.
 */
export interface IntelCollectionPoint {
  /** UTC date the runs were created, YYYY-MM-DD. */
  date: string;
  promptSetVersionId: string | null;
  runs: number;
  visibility: number | null;
  /** Answers naming the brand / answered collections in which it was tracked. */
  mention: IntelRate;
  prompts: number;
  engines: AiEngine[];
}

export interface IntelPromptEvidence {
  promptId: string;
  prompt: string;
  topic: string;
  intent: AiPromptIntent | null;
  branded: boolean;
  engines: {
    engine: AiEngine;
    answers: number;
    mentions: number;
    cited: number;
    recommended: number;
  }[];
  answers: {
    observationId: string;
    engine: AiEngine;
    runId: string;
    collectedAt: string | null;
    model: string | null;
    mentioned: boolean;
    cited: boolean;
    recommended: boolean | null;
  }[];
}

/** Keyset position after the last prompt of a page, in topic, text, id order. */
export interface IntelEvidenceCursor {
  topic: string;
  prompt: string;
  promptId: string;
}

export interface IntelEvidencePage {
  brandDomain: string | null;
  prompts: IntelPromptEvidence[];
  nextCursor: IntelEvidenceCursor | null;
}

export interface IntelPromptSetVersion {
  id: string | null;
  version: number | null;
  runs: number;
  selected: boolean;
}

export interface AiVisibilityIntelligence {
  window: { start: string; end: string; days: number };
  observedWindow: { start: string; end: string } | null;
  promptSet: {
    versions: IntelPromptSetVersion[];
    selectedVersionId: string | null;
    excludedRuns: number;
  };
  truncated: boolean;
  options: {
    engines: AiEngine[];
    topics: string[];
    /** Intents of prompts in the selected prompt set; "unknown" when unset. */
    intents: (AiPromptIntent | "unknown")[];
    brands: { name: string; domain: string; own: boolean }[];
  };
  coverage: IntelCoverage;
  repeatRuns: { runCount: number; level: string; note: string };
  target: IntelBrand | null;
  brandsCompared: number;
  leaderboard: IntelBrand[];
  trend: IntelTrendPoint[];
  comparison: {
    previousWindow: { start: string; end: string };
    comparable: boolean;
    reason: string | null;
  };
  /** Per collection day, the default trend view. */
  collectionTrend: IntelCollectionPoint[];
  /** The brand whose evidence getAiVisibilityEvidencePage lists by default. */
  evidence: { brandDomain: string | null };
  models: { engine: AiEngine; models: string[] }[];
  warnings: string[];
}

/** Shown beside each metric so the number can be checked by hand. */
export const INTEL_FORMULAS = {
  visibility:
    "For each engine, the share of runs naming the brand is worked out per prompt, then averaged across prompts. The engine figures are then averaged with equal weight, so an engine with fewer answers counts as much as one with more. Only answered collections count.",
  mention:
    "Answers naming the brand divided by all answered collections in scope, with no weighting.",
  shareOfVoice:
    "Answers naming this brand divided by the sum, over every compared brand, of answers naming that brand.",
  position:
    "In each answer that names the brand, its rank among compared brands by where each is first named. Averaged over those answers.",
  citationAmongMentioned:
    "Answers that name the brand and cite a page on its domain, divided by answers that name it. It is not the share of all answers citing the brand.",
  citedAnswers:
    "Answers citing a page on the brand's domain divided by all answered collections in scope.",
  sentiment:
    "Answers naming the brand are labeled positive, neutral, negative or mixed by a small model reading the stored answer text. Counts cover only the mentions that have a label; the model is recorded with each label.",
  recommendation:
    "Answers with explicit recommendation language for the brand, divided by answers that name it. Detected by a phrase heuristic, not a model.",
} as const;
