import type { AiPromptIntent } from "./ai-prompt-intent";
import type { AiEngine } from "./ai-visibility";
import type { IntelRate } from "./ai-visibility-intelligence";
import type {
  PerceptionOutcome,
  PerceptionSentiment,
  PerceptionStance,
} from "./ai-perception";

/** Who and what a figure covers, so it can be checked by hand. */
export interface PerceptionPopulation {
  window: { start: string; end: string; days: number };
  promptSetVersionId: string | null;
  prompts: number;
  engines: AiEngine[];
  runs: number;
  /** Collections planned in scope, and how many produced answer text. */
  planned: number;
  answered: number;
  /** Planned collections with no usable answer: failed, empty or pending. */
  missing: number;
  repeatRuns: { runCount: number; level: string; note: string };
  classifierVersion: string;
}

export interface PerceptionBrandView {
  name: string;
  domain: string;
  own: boolean;
  /** Answers naming the brand over answers with text. */
  mention: IntelRate;
  /** Answers citing a page on the brand's domain over answers with text. */
  cited: IntelRate;
  /** Mentions that have a reading, and those that do not yet. */
  read: number;
  unread: number;
  /** Over the mentions that have a reading. */
  recommendedOfMentions: IntelRate;
  discouragedOfMentions: IntelRate;
  /** Over every answer with text, so it is the share of the question set. */
  recommendedOfAnswers: IntelRate;
  sentiment: Record<PerceptionSentiment, number>;
  stance: Record<PerceptionStance, number>;
  corrected: number;
  ambiguous: number;
  /** Against the previous window of the same prompt set, when comparable. */
  change: {
    previous: IntelRate;
    difference: number | null;
    verdict: string;
  } | null;
}

export interface PerceptionHeatmapCell {
  domain: string;
  counts: Record<PerceptionOutcome, number>;
  /** Answers behind the cell: counts sum to this. */
  answers: number;
}

export interface PerceptionHeatmapRow {
  promptId: string;
  prompt: string;
  topic: string;
  intent: AiPromptIntent | null;
  cells: PerceptionHeatmapCell[];
}

export interface PerceptionTopicRow {
  topic: string;
  prompts: number;
  cells: PerceptionHeatmapCell[];
}

export type PerceptionSentimentComparison =
  | {
      previous: {
        start: string;
        end: string;
        counts: PerceptionBrandView["sentiment"];
      };
      reason: null;
    }
  | { previous: null; reason: string };

export interface AiPerceptionView {
  population: PerceptionPopulation;
  brands: PerceptionBrandView[];
  topics: PerceptionTopicRow[];
  heatmap: PerceptionHeatmapRow[];
  /** Answers naming a brand that have no reading yet, and what reading them costs. */
  unread: { answers: number; runIds: string[]; estimateUsd: number };
  /** Why change is or is not shown. */
  comparison: { comparable: boolean; reason: string | null };
  sentimentComparison: PerceptionSentimentComparison;
  warnings: string[];
}

export interface PerceptionCellAnswer {
  observationId: string;
  engine: AiEngine;
  collectedAt: string | null;
  model: string | null;
  outcome: PerceptionOutcome;
  reading: {
    id: string;
    stance: PerceptionStance;
    sentiment: PerceptionSentiment;
    reviewed: boolean;
    confidence: string;
    evidence: string | null;
    ambiguousName: boolean;
    strengths: string[];
    weaknesses: string[];
    objections: string[];
    comparisons: { competitor: string; outcome: string }[];
  } | null;
}

export interface PerceptionCellEvidence {
  promptId: string | null;
  topic: string | null;
  prompt: string | null;
  brand: { name: string; domain: string } | null;
  answers: PerceptionCellAnswer[];
}
