import type { AiEngine } from "./ai-visibility";
import type { IntelRate } from "./ai-visibility-intelligence";
import type { PerceptionOutcome, PerceptionPointKind } from "./ai-perception";
import type {
  PerceptionCellAnswer,
  PerceptionPopulation,
} from "./ai-perception-view";

/** What the brand's answers looked like wherever a source was cited. */
export interface PerceptionSourceRow {
  domain: string;
  /** Source class from the host alone; "own" and "competitor" come from the tracked brands. */
  sourceClass: string;
  title: string | null;
  /** Answers that cite the source, among answers where the brand was tracked. */
  answers: number;
  /** The brand's outcome in those answers; counts sum to `answers`. */
  outcomes: Record<PerceptionOutcome, number>;
  /** Recommended over the brand's read mentions in those answers. */
  recommended: IntelRate;
  /** Answers that retrieved the source without citing it; null when no engine in scope reports retrievals. */
  retrievedNotCited: number | null;
  engines: AiEngine[];
  pages: { url: string; title: string | null; answers: number }[];
}

export interface PerceptionTheme {
  /** Stable for the same wording so a filter can refer to it. */
  id: string;
  kind: PerceptionPointKind;
  label: string;
  /** Distinct answers whose reading raised it, over the brand's read mentions. */
  answers: IntelRate;
  engines: AiEngine[];
  prompts: number;
  /** A few quoted passages with the answer they came from. */
  examples: {
    observationId: string;
    engine: AiEngine;
    text: string;
    quote: string;
  }[];
}

export interface AiPerceptionSources {
  population: PerceptionPopulation;
  brand: { name: string; domain: string } | null;
  /** The brand's recommended share over all its read mentions, the baseline for each source. */
  baseline: IntelRate;
  sources: PerceptionSourceRow[];
  themes: PerceptionTheme[];
  /** Why a section is empty or limited. */
  notes: string[];
}

export interface PerceptionSourceEvidence {
  domain: string;
  brand: { name: string; domain: string } | null;
  pages: { url: string; title: string | null; position: number }[];
  /** Answers citing the source; reading shape matches the heatmap cells. */
  answers: PerceptionCellAnswer[];
}
