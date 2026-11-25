import type { IntelRate } from "./ai-visibility-intelligence";
import type { PerceptionSentiment, PerceptionStance } from "./ai-perception";

export const EXPERIMENT_STATUSES = ["draft", "replayed", "approved"] as const;
export const EXPERIMENT_ARMS = ["control", "variant"] as const;

type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export type ExperimentArm = (typeof EXPERIMENT_ARMS)[number];

/** Bounds on one replay, so its cost is known before it runs. */
export const EXPERIMENT_LIMITS = {
  prompts: 5,
  repeats: 5,
  minRepeatsForVerdict: 3,
  pageChars: 6000,
} as const;

interface ExperimentCostPreview {
  calls: number;
  /** Upper estimate for the model calls of one replay. */
  estimatedUsd: number;
}

// One simulated answer plus one reading of it, at a generous estimate.
const USD_PER_REPLAY = 0.003;

/** Two arms of every prompt, repeated; each call is an answer and a reading. */
export function experimentCostPreview(
  prompts: number,
  repeats: number,
): ExperimentCostPreview {
  const calls = prompts * repeats * EXPERIMENT_ARMS.length;
  return {
    calls,
    estimatedUsd: Math.round(calls * USD_PER_REPLAY * 1000) / 1000,
  };
}

/** One simulated answer, read for how it treats the brand. */
export interface ExperimentReplay {
  id: string;
  promptId: string;
  arm: ExperimentArm;
  repeat: number;
  answer: string;
  named: boolean;
  stance: PerceptionStance | null;
  sentiment: PerceptionSentiment | null;
  evidence: string | null;
}

export interface ExperimentPromptResult {
  promptId: string;
  prompt: string;
  topic: string;
  control: ExperimentArmTally;
  variant: ExperimentArmTally;
  /** Saved real answers for this prompt, from the collected runs. */
  real: { recommended: number; read: number };
  replays: ExperimentReplay[];
}

export interface ExperimentArmTally {
  answers: number;
  named: number;
  recommended: number;
}

/**
 * What the replay found. The control repeats show how much the same input
 * varies on its own, so a difference inside that spread is not called a move.
 */
export interface ExperimentVerdict {
  control: IntelRate;
  variant: IntelRate;
  /** Share of prompts whose control repeats did not all read the same. */
  noise: IntelRate;
  repeats: number;
  call: "moved_up" | "moved_down" | "within_noise" | "too_few_repeats";
  explanation: string;
}

export interface PerceptionExperimentSummary {
  id: string;
  title: string;
  status: ExperimentStatus;
  sourceUrl: string | null;
  createdAt: string;
  replayedAt: string | null;
  approvedAt: string | null;
  approvedBy: "person" | "agent" | null;
  repeats: number;
  prompts: number;
  costUsd: number;
}

export interface PerceptionExperiment extends PerceptionExperimentSummary {
  originalText: string;
  editedText: string;
  assumptions: string;
  brand: { name: string; domain: string };
  opportunityId: string | null;
  model: string | null;
  promptResults: ExperimentPromptResult[];
  verdict: ExperimentVerdict | null;
  /** Always shown: this is a model given the page, not an engine's own retrieval. */
  simulationNote: string;
}

export interface ExperimentPromptChoice {
  promptId: string;
  prompt: string;
  topic: string;
}

export interface PerceptionExperimentList {
  brand: { name: string; domain: string } | null;
  experiments: PerceptionExperimentSummary[];
  prompts: ExperimentPromptChoice[];
}
