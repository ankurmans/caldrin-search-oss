import type { AiEngine } from "./ai-visibility";

export type CitationSourceKind = "own" | "competitor" | "third_party";

export interface CitationSourceRow {
  domain: string;
  kind: CitationSourceKind;
  /** The tracked brand whose domain this is, for own and competitor sources. */
  brandName: string | null;
  urls: { url: string; title: string | null; answers: number }[];
  /** Answered collections citing a page on this domain (once per answer). */
  answers: number;
  prompts: number;
  promptGroups: string[];
  engines: { engine: AiEngine; answers: number }[];
  /** Tracked brands named in the answers that cite this source. */
  brandsNamed: {
    domain: string;
    name: string;
    own: boolean;
    answers: number;
  }[];
  /** Answers citing this source that also name your brand. */
  ownNamedAnswers: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export type CitationGapType =
  | "missing_commercial_content"
  | "missing_comparison_coverage"
  | "missing_independent_corroboration"
  | "third_party_publisher"
  | "brand_information_review"
  | "measurement_uncertainty";

export type GapAction =
  | "new_article"
  | "create_page"
  | "earn_third_party_coverage"
  | "review_brand_information";

export interface CitationGapFinding {
  key: string;
  type: CitationGapType;
  promptGroup: string;
  title: string;
  summary: string;
  suggestedAction: string;
  /** Null for a finding that is a note about the data, not something to do. */
  action: GapAction | null;
  prompts: { promptId: string; prompt: string; intent: string | null }[];
  competitors: { domain: string; name: string; answers: number }[];
  sources: { domain: string; urls: string[]; answers: number }[];
  observed: { first: string | null; last: string | null };
  /** Answers behind the finding, newest first, capped. */
  answerIds: string[];
  answersInGroup: number;
  factors: { label: string; value: string }[];
  priority: "high" | "medium" | "low";
  priorityReason: string;
  effort: { level: "low" | "medium" | "high"; reason: string };
  uncertain: boolean;
  uncertaintyNotes: string[];
  /** Set when a Search Opportunity already exists for this finding. */
  opportunityId: string | null;
}

export interface CitationGapAnalysis {
  window: { start: string; end: string; days: number };
  promptSetVersionId: string | null;
  coverage: {
    runs: number;
    answered: number;
    planned: number;
    prompts: number;
    engines: AiEngine[];
  };
  ownBrand: { name: string; domain: string } | null;
  options: { engines: AiEngine[]; topics: string[] };
  sources: CitationSourceRow[];
  findings: CitationGapFinding[];
  notes: string[];
}

export interface CitationSourceDetail {
  domain: string;
  kind: CitationSourceKind;
  answers: {
    observationId: string;
    prompt: string;
    promptGroup: string;
    engine: AiEngine;
    collectedAt: string | null;
    urls: string[];
    brandsNamed: { name: string; own: boolean }[];
    /** Literal answer text around the citation, from the saved answer. */
    passages: string[];
  }[];
  truncated: boolean;
}

export const GAP_TYPE_LABELS: Record<CitationGapType, string> = {
  missing_commercial_content: "Missing content on your site",
  missing_comparison_coverage: "Missing comparison coverage",
  missing_independent_corroboration: "Missing independent corroboration",
  third_party_publisher: "Third-party source to pursue",
  brand_information_review: "Check what answers say about you",
  measurement_uncertainty: "Measurement uncertainty",
};

export interface RankedActionReading {
  /** Answered collections in the prompt group, split at the day the opportunity was stored. */
  before: { answered: number; namingYou: number };
  after: { answered: number; namingYou: number };
  note: string;
}

export interface RankedAction {
  rank: number;
  /** Owned work is done on your site; earned work needs someone else to publish. */
  kind: "owned" | "earned";
  action: GapAction;
  findingKey: string;
  title: string;
  promptGroup: string;
  suggestedAction: string;
  priority: CitationGapFinding["priority"];
  effort: CitationGapFinding["effort"];
  uncertain: boolean;
  opportunityId: string | null;
  opportunityStatus: "open" | "briefed" | "dismissed" | null;
  opportunityStoredAt: string | null;
  /** Only for an action already stored as an opportunity; observation, not cause. */
  reading: RankedActionReading | null;
}

export interface RankedActions {
  window: CitationGapAnalysis["window"];
  ownBrand: CitationGapAnalysis["ownBrand"];
  actions: RankedAction[];
  notes: string[];
}
