import type {
  Confidence,
  ConsensusPattern,
  PromptAnswerStats,
  Recommendation,
  RootCause,
} from "@/shared/source-gap";
import type { OwnerSelection } from "@/shared/source-gap-owner";
import type { DiffInput } from "./sourceGapDifferences";

export interface DiagnosisInput extends DiffInput {
  intent: string | null;
  runCount: number;
  selection: OwnerSelection;
  stats: PromptAnswerStats;
}

export interface Diagnosis {
  consensus: ConsensusPattern[];
  rootCauses: RootCause[];
  recommendations: Recommendation[];
  notes: string[];
}

export const share = (n: number, d: number) => (d === 0 ? 0 : n / d);
export const pattern = (all: ConsensusPattern[], key: string) =>
  all.find((p) => p.key === key);
export const countText = (p: ConsensusPattern) =>
  `${p.citedCount} of ${p.readable} cited pages`;

export function confidenceFrom(
  supporting: number,
  readable: number,
  runCount: number,
): Confidence {
  const base: Confidence =
    supporting >= 3 && readable >= 4
      ? "high"
      : supporting >= 2
        ? "medium"
        : "low";
  // One collection run is one sample of what the engines cited.
  return runCount < 2 && base === "high" ? "medium" : base;
}
