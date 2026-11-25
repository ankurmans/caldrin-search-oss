import type { AiEngine } from "./ai-visibility";
import type { OwnerConfidence, OwnerSelection } from "./source-gap-owner";

/** Who published a cited page, and in what role. */
export type SourceType =
  | "own"
  | "competitor_owned"
  | "editorial"
  | "community"
  | "platform"
  | "documentation"
  | "review_roundup"
  | "unknown";

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  own: "Your site",
  competitor_owned: "Competitor site",
  editorial: "Third-party editorial",
  community: "Community / UGC",
  platform: "Platform",
  documentation: "Documentation",
  review_roundup: "Review / roundup",
  unknown: "Unknown",
};

/** How the answers behind an analysis were collected. */
export type CollectionMode = "api_benchmark" | "scraper" | "mixed";

export const COLLECTION_MODE_LABELS: Record<CollectionMode, string> = {
  api_benchmark: "API benchmark (live model API with web search)",
  scraper: "Scraper (consumer product or Google results, via a provider)",
  mixed: "Mixed (API and scraper engines)",
};

export type SnapshotFetchStatus =
  | "ok"
  | "blocked_by_robots"
  | "challenge"
  | "not_found"
  | "http_error"
  | "unreachable"
  | "not_html"
  | "homepage_only"
  | "skipped";

export const SNAPSHOT_STATUS_LABELS: Record<SnapshotFetchStatus, string> = {
  ok: "Fetched",
  blocked_by_robots: "Blocked by robots.txt",
  challenge: "Bot challenge",
  not_found: "Not found",
  http_error: "HTTP error",
  unreachable: "Unreachable",
  not_html: "Not an HTML page (PDF or file)",
  homepage_only: "Homepage only",
  skipped: "Not fetched (over the page limit)",
};

export type CommercialFactKey =
  | "price"
  | "payAsYouGo"
  | "noSubscription"
  | "subscription"
  | "freeTier"
  | "trial"
  | "refund"
  | "lifetime"
  | "perSeat"
  | "perMinute"
  | "perHour"
  | "credits";

export const COMMERCIAL_FACT_LABELS: Record<CommercialFactKey, string> = {
  price: "Explicit price",
  payAsYouGo: "Pay as you go",
  noSubscription: "No subscription",
  subscription: "Subscription",
  freeTier: "Free tier",
  trial: "Trial",
  refund: "Refund",
  lifetime: "Lifetime",
  perSeat: "Per seat",
  perMinute: "Per minute",
  perHour: "Per hour",
  credits: "Credits",
};

export type ComparisonSignalKey =
  | "comparisonTable"
  | "pricingTable"
  | "featureMatrix"
  | "alternativesList"
  | "prosCons"
  | "bestFor"
  | "verdict"
  | "comparisonHeading";

export const COMPARISON_SIGNAL_LABELS: Record<ComparisonSignalKey, string> = {
  comparisonTable: "Side-by-side table",
  pricingTable: "Pricing table",
  featureMatrix: "Feature matrix",
  alternativesList: "Alternatives list",
  prosCons: "Pros and cons",
  bestFor: "Best-for guidance",
  verdict: "Verdict",
  comparisonHeading: "Comparison heading",
};

export type TableKind = "pricing" | "comparison" | "feature" | "other";

export interface ParsedTable {
  kind: TableKind;
  headers: string[];
  rows: number;
}

export type PageKind =
  | "home"
  | "pricing"
  | "comparison"
  | "article"
  | "product"
  | "documentation"
  | "other";

/** What the extractor read from one page. Every field is observed, not inferred. */
export interface ParsedPage {
  finalUrl: string;
  canonical: string | null;
  title: string | null;
  metaDescription: string | null;
  robotsMeta: string | null;
  hreflang: string[];
  h1s: string[];
  h2s: string[];
  h3s: string[];
  /** Descriptive only; never a recommendation. */
  wordCount: number;
  /** Visible text, capped. */
  text: string;
  tables: ParsedTable[];
  listCount: number;
  hasFaq: boolean;
  schemaTypes: string[];
  internalLinkCount: number;
  /** Same-site pages this page links to, for finding pages no list names; absent on copies stored earlier. */
  internalLinks?: string[];
  externalLinks: { url: string; anchor: string }[];
  author: string | null;
  reviewer: string | null;
  credentials: string[];
  quoteCount: number;
  publishedAt: string | null;
  modifiedAt: string | null;
  visibleUpdated: string | null;
  pageKind: PageKind;
  commercial: Partial<Record<CommercialFactKey, string>>;
  comparison: Partial<Record<ComparisonSignalKey, string>>;
  firstHand: string[];
  methodology: boolean;
  /** Images in the main content; screenshots are not told apart from photos. */
  imageCount: number;
}

export interface SnapshotView {
  id: string;
  url: string;
  normalizedUrl: string;
  status: SnapshotFetchStatus;
  httpStatus: number | null;
  fetchedAt: string;
  contentHash: string | null;
  /** Fetched through a rendering service rather than a plain request. */
  rendered: boolean;
  /** Null unless status is "ok". */
  page: ParsedPage | null;
  /** Why a page could not be read, in plain words. */
  note: string | null;
}

export interface CitedSourceSummary {
  /** Normalized URL, one row per distinct page. */
  url: string;
  domain: string;
  title: string | null;
  sourceType: SourceType;
  brandName: string | null;
  answers: number;
  engines: AiEngine[];
  bestPosition: number | null;
  observationIds: string[];
  /** Tracked brands named in the answers that cite this page. */
  brandsNamedInAnswers: string[];
  ownNamedInAnswers: boolean;
  snapshot: SnapshotView | null;
  /** Tracked competitors and your brand named in the page's own text. */
  brandsOnPage: string[];
  ownOnPage: boolean;
}

export type GapDimensionKey =
  | "intent"
  | "entities"
  | "commercial"
  | "comparison"
  | "firstHand"
  | "expert"
  | "tables"
  | "evidenceLinks"
  | "recency"
  | "internalLinks"
  | "corroboration"
  | "authority";

export const GAP_DIMENSION_LABELS: Record<GapDimensionKey, string> = {
  intent: "Title and H1 vs the prompt",
  entities: "Entity coverage",
  commercial: "Pricing and commercial facts",
  comparison: "Comparison structure",
  firstHand: "First-hand evidence",
  expert: "Author and reviewer signals",
  tables: "Tables and structured facts",
  evidenceLinks: "Outbound evidence links",
  recency: "Dates",
  internalLinks: "Internal links",
  corroboration: "Independent corroboration",
  authority: "Backlinks and authority",
};

export type DimensionVerdict =
  | "cited_stronger"
  | "similar"
  | "yours_stronger"
  | "not_measured"
  | "not_comparable";

export interface DimensionRow {
  dimension: GapDimensionKey;
  cited: string;
  yours: string;
  verdict: DimensionVerdict;
}

/** One cited page against your owner page. */
export interface SourceDifference {
  url: string;
  rows: DimensionRow[];
}

export interface ConsensusPattern {
  key: string;
  dimension: GapDimensionKey;
  label: string;
  /** Pages with the signal, of the pages that could be read. */
  citedCount: number;
  readable: number;
  yours: boolean | null;
  urls: string[];
}

export type RootCauseCategory =
  | "retrieval_intent_mismatch"
  | "missing_facts"
  | "weak_comparison_structure"
  | "weak_entity_coverage"
  | "weak_information_gain"
  | "weak_third_party_corroboration"
  | "weak_authority"
  | "freshness_gap"
  | "no_owner_page"
  | "owner_unconfirmed"
  | "owner_page_type_mismatch"
  | "no_clear_content_gap";

export const ROOT_CAUSE_LABELS: Record<RootCauseCategory, string> = {
  retrieval_intent_mismatch: "Retrieval intent mismatch",
  missing_facts: "Missing facts",
  weak_comparison_structure: "Weak comparison structure",
  weak_entity_coverage: "Weak entity coverage",
  weak_information_gain: "Weak information gain",
  weak_third_party_corroboration: "Weak third-party corroboration",
  weak_authority: "Weak authority",
  freshness_gap: "Freshness gap",
  no_owner_page: "No owner page",
  owner_unconfirmed: "Owner page not confirmed",
  owner_page_type_mismatch: "Closest page is the wrong kind",
  no_clear_content_gap: "No clear content gap",
};

/** Whether a statement was seen on a page, drawn from what was seen, or a guess to test. */
export type EvidenceLevel = "observed" | "inferred" | "hypothesis";

export type Confidence = "high" | "medium" | "low";

export interface RootCause {
  category: RootCauseCategory;
  /** What was observed, in one sentence with counts. */
  evidence: string;
  level: EvidenceLevel;
  supportingUrls: string[];
  confidence: Confidence;
}

export type RecommendationAction =
  | "improve_existing_owner"
  | "add_pricing_fact"
  | "add_comparison_table"
  | "add_best_for_section"
  | "add_competitor_entities"
  | "add_first_hand_test"
  | "add_original_benchmark"
  | "strengthen_attribution"
  | "update_stale_content"
  | "add_structured_table"
  | "improve_internal_links"
  | "pursue_independent_mentions"
  | "pursue_links_from_cited_ecosystem"
  | "create_owner_page"
  | "choose_owner_page"
  | "no_change_measure_more";

export const RECOMMENDATION_LABELS: Record<RecommendationAction, string> = {
  improve_existing_owner: "Improve the existing owner page",
  add_pricing_fact: "State the missing pricing facts",
  add_comparison_table: "Add a comparison table",
  add_best_for_section: "Add a best-for section",
  add_competitor_entities: "Cover the products buyers compare",
  add_first_hand_test: "Add a first-hand test",
  add_original_benchmark: "Publish an original benchmark",
  strengthen_attribution: "Add a named author or reviewer",
  update_stale_content: "Show when the page was updated",
  add_structured_table: "Put the key facts in a table",
  improve_internal_links: "Link to the page from related pages",
  pursue_independent_mentions: "Earn independent mentions",
  pursue_links_from_cited_ecosystem:
    "Earn links from sources answers already cite",
  create_owner_page: "Create a page for this prompt",
  choose_owner_page: "Check the closest existing pages first",
  no_change_measure_more: "No page change; collect more runs",
};

export interface Recommendation {
  action: RecommendationAction;
  /** The observed gap this rests on, with counts. */
  reason: string;
  /** What to expect, worded as a test and never as a promise. */
  expectedEffect: string;
  effort: Confidence;
  /** Work outside the owner page, such as other sites. */
  dependency: "none" | "third_party";
  confidence: Confidence;
  priority: "high" | "medium" | "low";
  priorityReason: string;
  level: EvidenceLevel;
  rootCause: RootCauseCategory;
  supportingUrls: string[];
}

export interface PromptAnswerStats {
  engines: { engine: AiEngine; answers: number }[];
  answers: number;
  ownMentions: number;
  ownCitations: number;
  competitorMentions: number;
  answersWithCompetitorOnly: number;
}

export interface SourceGapAnalysis {
  id: string;
  projectId: string;
  promptId: string;
  prompt: string;
  topic: string;
  intent: string | null;
  runIds: string[];
  createdAt: string;
  collectionMode: CollectionMode;
  stats: PromptAnswerStats;
  owner: OwnerSelection;
  ownerSnapshot: SnapshotView | null;
  sources: CitedSourceSummary[];
  differences: SourceDifference[];
  consensus: ConsensusPattern[];
  rootCauses: RootCause[];
  recommendations: Recommendation[];
  /** Plain-language limits of this analysis. */
  measurementNotes: string[];
  /** Search Opportunity created from this analysis, if any. */
  opportunityId: string | null;
  /** What changed against the previous analysis of the same prompt. */
  changes: string[];
  previousAnalysisId: string | null;
}

export interface SourceGapSummary {
  id: string;
  promptId: string;
  createdAt: string;
  topRootCause: RootCauseCategory | null;
  ownerUrl: string | null;
  ownerConfidence: OwnerConfidence | null;
  sourcesAnalyzed: number;
  opportunityId: string | null;
}

export interface TopicSourceGap {
  topic: string;
  prompts: number;
  analyzed: number;
  answers: number;
  competitorMentionsWithoutYou: number;
  competitorOwnedCitations: number;
  patterns: {
    category: RootCauseCategory;
    prompts: { promptId: string; prompt: string }[];
  }[];
}
