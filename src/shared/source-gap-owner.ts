export type OwnerConfidence = "high" | "medium" | "low";

/**
 * What kind of page an owner candidate reads as: from its body once read, from
 * its address and heading before. "unknown" means the purpose could not be
 * established, which is not the same as the page being irrelevant.
 */
export type OwnerPageType =
  | "how_to"
  | "comparison"
  | "pricing"
  | "product"
  | "unknown";

export const OWNER_PAGE_TYPE_LABELS: Record<OwnerPageType, string> = {
  how_to: "How-to guide",
  comparison: "Comparison",
  pricing: "Pricing page",
  product: "One product",
  unknown: "Purpose unclear",
};

/** What happened when Caldrin tried to read a candidate page, apart from what the page says. */
export type RetrievalState =
  | "FETCHED_AND_CLASSIFIED"
  | "FETCHED_INSUFFICIENT_CONTENT"
  | "FETCH_FAILED"
  | "BLOCKED"
  | "REDIRECT_ERROR"
  | "NOT_ATTEMPTED";

export const RETRIEVAL_LABELS: Record<RetrievalState, string> = {
  FETCHED_AND_CLASSIFIED: "Read",
  FETCHED_INSUFFICIENT_CONTENT: "Read, very little text",
  FETCH_FAILED: "Could not be read",
  BLOCKED: "Blocked",
  REDIRECT_ERROR: "Redirect problem",
  NOT_ATTEMPTED: "Not read yet",
};

/** How an address came to be a candidate. */
export type DiscoverySource =
  | "sitemap"
  | "crawl"
  | "search_console"
  | "internal_link"
  | "manual";

export const DISCOVERY_LABELS: Record<DiscoverySource, string> = {
  sitemap: "Sitemap",
  crawl: "Site crawl",
  search_console: "Search Console",
  internal_link: "Linked from another page",
  manual: "Chosen by a person",
};

/** How much page text a judgement rests on. */
export type EvidenceQuality = "strong" | "partial" | "thin" | "none";

/** What existing pages say about the prompt, apart from how well each was read. */
export type GapOutcome =
  | "EXISTING_OWNER_CONFIRMED"
  | "EXISTING_OWNER_PROBABLE"
  | "OWNER_UNCERTAIN"
  | "CONTENT_GAP_CONFIRMED";

/** True when the page was read well enough to be compared with others. */
export const isCandidateRead = (c: Pick<OwnerCandidate, "retrieval">) =>
  c.retrieval === "FETCHED_AND_CLASSIFIED" ||
  c.retrieval === "FETCHED_INSUFFICIENT_CONTENT";

export const GAP_OUTCOME_LABELS: Record<GapOutcome, string> = {
  EXISTING_OWNER_CONFIRMED: "Existing page confirmed",
  EXISTING_OWNER_PROBABLE: "Existing page probable",
  OWNER_UNCERTAIN: "Owner uncertain",
  CONTENT_GAP_CONFIRMED: "No page for this prompt",
};

export const GAP_OUTCOME_EXPLANATIONS: Record<GapOutcome, string> = {
  EXISTING_OWNER_CONFIRMED: "An existing page answers this prompt.",
  EXISTING_OWNER_PROBABLE:
    "An existing page probably answers this prompt, but something is not settled.",
  OWNER_UNCERTAIN:
    "Caldrin cannot yet say whether a page for this prompt exists, so it does not suggest a new page.",
  CONTENT_GAP_CONFIRMED:
    "Every plausible page was read and none speaks to this prompt.",
};

export interface OwnerCandidate {
  /** The address the page is judged under: where it resolves to, once read. */
  url: string;
  title: string | null;
  /**
   * Relevance to the prompt. Only a read page has a relevance; for a page that
   * was not read it is a first guess from its address and title, and says
   * nothing about the page.
   */
  score: number;
  pageType?: OwnerPageType;
  /** How well the page's type fits what the prompt asks for, 0 to 1; absent when the type says nothing. */
  typeFit?: number;
  /** Products the page sets side by side, when it has been read. */
  optionsCompared?: number;
  /** How sure this page is the owner, judged against the others. Absent for a page that was not read. */
  confidence?: OwnerConfidence;
  /** Plain-language evidence for how the page was scored. */
  reasons: string[];
  signals: {
    intentAlignment: number;
    slugMatch: number;
    gscQueryOverlap: number;
    entityMatch: number;
    factMatch: number;
  };
  /** The fields below are absent on analyses stored before they existed. */
  retrieval?: RetrievalState;
  /** Why the page could not be read, when it could not. */
  retrievalNote?: string | null;
  /** True when reading it again could work. */
  retryable?: boolean;
  evidenceQuality?: EvidenceQuality;
  /** What the page would need to show to be a better answer, or what could not be judged. */
  missingEvidence?: string[];
  /** Why this page sits above or below its neighbours. */
  ranking?: string[];
  discoveredVia?: DiscoverySource[];
  /** Where the page was verified to resolve to, when that is not the address that was listed. */
  finalUrl?: string;
  /** The address the page's own canonical tag names, when it differs from where it was read. */
  declaredCanonical?: string | null;
  /** Other addresses that are this same page. */
  alsoListedAs?: string[];
}

export interface OwnerSelection {
  /** Null is the MISSING OWNER PAGE state. */
  selected: OwnerCandidate | null;
  confidence: OwnerConfidence | null;
  candidates: OwnerCandidate[];
  /** True when a person chose this page. It is then their choice, not one Caldrin verified. */
  overridden: boolean;
  /** Absent on analyses stored before outcomes existed. */
  outcome?: GapOutcome;
  notes: string[];
  /** Pages of the site that were scored, so "none found" can be told from "few looked at". */
  pagesChecked?: number;
  /** False when the sitemap or crawl could not be read in full. */
  listComplete?: boolean;
}
