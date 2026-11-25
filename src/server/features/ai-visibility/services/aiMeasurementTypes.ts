import type { AiEngine } from "@/shared/ai-visibility";

/** Below this many runs per side the sample is anecdote, not a rate. */
export const MIN_RUNS_FOR_ANALYSIS = 10;
/** Below this many runs per side a number is not client-ready. */
export const MIN_RUNS_FOR_CLIENT_NUMBER = 30;
export const MAX_RUNS_PER_SIDE = 100;
export const TOP_LIST_SIZE = 10;

/** Run ids to measure, or every finished run created inside a window. */
export type MeasurementSelector =
  | { runIds: string[] }
  | { window: { start: string; end: string } };

export interface Rate {
  numerator: number;
  denominator: number;
  /** numerator / denominator as a 0..1 fraction; null when the denominator is 0. */
  rate: number | null;
}

export interface AnswerCounts {
  /** Every answer the runs planned. */
  planned: number;
  /** Completed with an answer: the only answers any rate counts. */
  answered: number;
  /** Completed, but the engine gave no answer (for example no AI Overview). */
  noAnswer: number;
  failed: number;
  pending: number;
  /** noAnswer + failed + pending: left out of every denominator. */
  excluded: number;
}

export interface CitedItem {
  key: string;
  /** Answers that cite it. */
  answers: number;
  share: number | null;
}

export interface Measurement {
  engine: AiEngine | "all";
  counts: AnswerCounts;
  /** Distinct models providers reported; empty when none did. */
  models: string[];
  /** The own brand named in the answer. */
  mention: Rate;
  /** An own-domain page cited. */
  ownCitation: Rate;
  /**
   * An explicit recommendation of the own brand, over answers that state an
   * explicit verdict only. Null denominators mean no verdict was detected.
   */
  recommendation: Rate & { detection: "explicit_language_heuristic" };
  /**
   * Own-domain citation split into pool membership (prompts cited by at least
   * one answer) and selection (answers citing, among those prompts).
   */
  pool: {
    prompts: number;
    promptsCited: number;
    selection: Rate;
  };
  competitors: {
    name: string;
    domain: string;
    mention: Rate;
    citation: Rate;
  }[];
  topCitedDomains: CitedItem[];
  topCitedUrls: CitedItem[];
}

export type RepeatRunLevel =
  | "single_run"
  | "below_analysis_floor"
  | "below_client_number_floor"
  | "adequate";

export interface SideMeasurement {
  runCount: number;
  runIds: string[];
  /** Runs with at least one answered observation; the repeat-run count. */
  contributingRuns: number;
  /** Runs still queued or running; their unfinished answers are excluded. */
  unfinishedRuns: number;
  /** First run created to last run finished. Null without runs. */
  observedWindow: { start: string; end: string } | null;
  /** Null stands for runs created before prompt-set versioning. */
  promptSetVersionIds: (string | null)[];
  engines: AiEngine[];
  markets: string[];
  ownBrands: string[];
  repeatRuns: {
    /** contributingRuns: runs that failed outright add no repeat. */
    runCount: number;
    level: RepeatRunLevel;
    minForAnalysis: number;
    minForClientNumber: number;
    note: string;
  };
  overall: Measurement;
  byEngine: Measurement[];
}

export type ComparabilityCode =
  | "no_runs"
  | "no_answers"
  | "window_truncated"
  | "overlapping_runs"
  | "unversioned_runs"
  | "mixed_prompt_set_versions"
  | "mixed_markets"
  | "prompt_set_version_mismatch"
  | "engine_set_mismatch"
  | "market_mismatch"
  | "own_brand_mismatch";

export type ChangeVerdict =
  | "not_assessable"
  | "insufficient_runs"
  | "within_noise"
  | "outside_noise";

export interface MetricChange {
  before: Rate;
  after: Rate;
  /** after.rate - before.rate as a 0..1 fraction; null when either is null. */
  difference: number | null;
  /**
   * insufficient_runs: either side is under the analysis floor, so the
   * difference is shown but is not a finding. within_noise: the 95% Wilson
   * intervals overlap. outside_noise: they do not, which still says nothing
   * about cause (prompts repeat across runs, so the intervals understate noise).
   */
  verdict: ChangeVerdict;
}

export interface MeasurementChange {
  engine: AiEngine | "all";
  mention: MetricChange;
  ownCitation: MetricChange;
  recommendation: MetricChange;
}

export interface WindowComparison {
  attribution: "observed_only";
  attributionNote: string;
  comparable: boolean;
  reasons: { code: ComparabilityCode; message: string }[];
  before: SideMeasurement;
  after: SideMeasurement;
  /** Null whenever comparable is false: no like-for-like change is offered. */
  changes: { overall: MeasurementChange; byEngine: MeasurementChange[] } | null;
  reliability: RepeatRunLevel;
}
