import type {
  GscRow,
  OpportunityAction,
} from "@/server/features/content/rules/opportunityRules";
import type { StoreSnapshot } from "@/server/features/content/rules/storeTypes";

export type OpportunityScope = {
  projectId: string;
  organizationId: string;
  userId: string;
};

export type OpportunityDataSource =
  | "gsc"
  | "simulated"
  | "dataforseo"
  | "serp"
  | "competitor"
  | "shopify"
  | "site_audit"
  | "ai_visibility"
  | "attribution"
  | "claim_correction";

export type OpportunityIntent =
  | "informational"
  | "commercial"
  | "transactional"
  | "navigational";

export type OpportunityPriority = "high" | "medium" | "low";

// One number or fact behind an opportunity, shown to the user as is.
export type EvidenceInput = {
  source: string;
  label: string;
  value: string;
  url?: string | null;
  observedAt?: string | null;
};

// An opportunity ready to store. The numeric GSC columns are zero when the
// opportunity does not come from Search Console; the evidence rows hold the
// numbers that actually apply.
export type OpportunityCandidate = {
  dedupeKey: string;
  query: string;
  pageUrl: string | null;
  action: OpportunityAction;
  reason: string;
  matchedCollectionHandle: string | null;
  dataSource: OpportunityDataSource;
  intent: OpportunityIntent | null;
  priority: OpportunityPriority;
  priorityReason: string;
  observedAt: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  windowStart: string;
  windowEnd: string;
  evidence: EvidenceInput[];
};

export type PageWindowRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type AuditIssueRow = {
  issueType: string;
  severity: "critical" | "warning" | "info";
  pageUrl: string;
};

// Everything the free rules read. Each part is null when the project has no
// such data, and the rules that need it are skipped and reported, never guessed.
export type EngineInputs = {
  gsc: {
    source: "gsc" | "simulated";
    rows: GscRow[];
    windowStart: string;
    windowEnd: string;
  } | null;
  // Page-level windows for the declining-page comparison. Null for simulated
  // data: there is no earlier window to compare and none is invented.
  pageWindows: {
    current: PageWindowRow[];
    previous: PageWindowRow[];
    currentStart: string;
    currentEnd: string;
    previousStart: string;
    previousEnd: string;
  } | null;
  store: StoreSnapshot | null;
  // "simulated" for the demo shop, so everything derived from it is labeled.
  storeMode: "live" | "simulated" | null;
  audit: {
    auditId: string;
    observedAt: string;
    issues: AuditIssueRow[];
  } | null;
  // Words that identify the brand, so a brand query reads as navigational.
  brandTerms: string[];
  // Reasons a source could not be read (not connected, API error).
  unavailable: { source: string; reason: string }[];
};

export type CompetitorKeyword = {
  keyword: string;
  competitorDomain: string;
  competitorPosition: number;
  competitorUrl: string | null;
  searchVolume: number | null;
  keywordDifficulty: number | null;
};

// The paid DataForSEO read, injected so tests never reach a real provider and
// the lead can bind the billing-aware client.
export interface PaidKeywordSource {
  fetchCompetitorKeywords(input: {
    competitorDomains: string[];
    limit: number;
  }): Promise<{
    keywords: CompetitorKeyword[];
    observedAt: string;
    // What the provider reported charging, when it reports one.
    costUsd: number | null;
  }>;
}

// Matches SpendService.assertWithinLimits; throws when a limit would be passed.
export interface SpendGate {
  assertWithinLimits(
    scope: OpportunityScope,
    input: { estimatedUsd: number; provider: string; operation: string },
  ): Promise<void>;
}

// Matches SpendService.recordCost.
export type RecordCost = (
  scope: OpportunityScope,
  input: {
    provider: string;
    operation: string;
    estimatedUsd?: number;
    costUsd: number;
  },
) => Promise<void>;

export type PaidKeywordGapRequest = {
  competitorDomains: string[];
  estimatedUsd: number;
  source: PaidKeywordSource;
  limit?: number;
};

export type RunOptions = {
  // Preloaded inputs, or a loader. Defaults to reading the project's own data.
  inputs?: EngineInputs | (() => Promise<EngineInputs>);
  // Paid DataForSEO rule: runs only when allowPaid is true AND a request with
  // an estimate is given AND a spend gate is supplied.
  allowPaid?: boolean;
  paid?: PaidKeywordGapRequest;
  spendGate?: SpendGate;
  recordCost?: RecordCost;
  // Defaults to the current time; fixed in tests.
  now?: Date;
  maxOpportunities?: number;
  maxNoAction?: number;
};

export type RunSummary = {
  observedAt: string;
  stored: number;
  byAction: Record<string, number>;
  skipped: { rule: string; reason: string }[];
  paid: { ran: boolean; estimatedUsd: number | null; costUsd: number | null };
  // Rows this run did not re-produce: removed when they had no history (no
  // draft, change entry, briefing or dismissal), kept and flagged otherwise.
  // Rows from rules that did not run this time are never counted.
  reconciled: { removed: number; keptStale: number };
};

export class OpportunityRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityRefusal";
  }
}
