import type {
  changeLedgerEntries,
  changeLedgerEvidence,
  changeLedgerObservations,
  providerCosts,
} from "@/db/schema";

export type LedgerEntry = typeof changeLedgerEntries.$inferSelect;
export type LedgerEvidence = typeof changeLedgerEvidence.$inferSelect;
export type LedgerObservation = typeof changeLedgerObservations.$inferSelect;
export type LedgerCostRow = typeof providerCosts.$inferSelect;

export type LedgerStatus = LedgerEntry["status"];
export type LedgerKind = LedgerEntry["kind"];
export type LedgerProvider = LedgerEntry["provider"];
export type RollbackKind = LedgerEntry["rollbackKind"];

export type LedgerScope = {
  projectId: string;
  organizationId: string;
  userId: string;
};

// Every ledger payload says what its numbers are: recorded readings, not proof.
export const ATTRIBUTION_NOTE =
  "Recorded before/after observation. It does not show that the change caused the difference.";

// An expected, user-facing refusal (approval missing, revision moved, wrong
// state). Server functions turn it into a typed result for the UI.
export class LedgerRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerRefusal";
  }
}

export type EvidenceInput = {
  source: string;
  label: string;
  value: string;
  url?: string | null;
  observedAt?: string | null;
};

export type ProposeChangeInput = {
  kind: LedgerKind;
  provider: LedgerProvider;
  proposedAction: string;
  opportunityId?: string | null;
  contentAssetId?: string | null;
  contentRevision?: number | null;
  targetUrl?: string | null;
  beforeState?: string | null;
  afterState?: string | null;
  rollbackKind?: RollbackKind;
  measurementMetric?: string | null;
  measurementWindowDays?: number | null;
  evidence?: EvidenceInput[];
  // Overrides the default `kind:subject:revision` key.
  idempotencyKey?: string;
};

export type RecordExecutionInput = {
  externalId?: string | null;
  targetUrl?: string | null;
  publicationStatus: "draft" | "published";
  diff?: string | null;
  afterState?: string | null;
  rollback?: { kind: RollbackKind; payload: string };
};

export type RecordObservationInput = {
  phase: LedgerObservation["phase"];
  source: LedgerObservation["source"];
  metric: string;
  value: number;
  numerator?: number | null;
  denominator?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  aiRunId?: string | null;
  note?: string | null;
};

export type ListEntriesFilter = {
  status?: LedgerStatus;
  kind?: LedgerKind;
  provider?: LedgerProvider;
  opportunityId?: string;
  limit?: number;
};

// Display names for the people on an entry, resolved from members of the
// entry's own organization. null means nobody was recorded for that step;
// "Unknown user" means someone was, but is not a member of this organization.
export type LedgerPeopleNames = {
  proposedByName: string;
  approvedByName: string | null;
  executedByName: string | null;
  rolledBackByName: string | null;
  // Who recorded the final decision. For a rejected entry this is the rejecter.
  finalDecidedByName: string | null;
};

export type LedgerEntryWithNames = LedgerEntry & LedgerPeopleNames;

export type LedgerEntryDetail = {
  entry: LedgerEntry;
  evidence: LedgerEvidence[];
  observations: LedgerObservation[];
  costs: { totalUsd: number; rows: LedgerCostRow[] };
  attribution: "observed_only";
  attributionNote: typeof ATTRIBUTION_NOTE;
};

export type LedgerEntryDetailWithNames = Omit<LedgerEntryDetail, "entry"> & {
  entry: LedgerEntryWithNames;
};

export type WindowOutcome = {
  status:
    | "recorded"
    | "already_recorded"
    | "no_data"
    | "too_early"
    | "unavailable";
  window: { start: string; end: string } | null;
  recorded: number;
  note: string | null;
};

export type CollectGscResult = {
  baseline: WindowOutcome;
  followUp: WindowOutcome;
  attribution: "observed_only";
  attributionNote: typeof ATTRIBUTION_NOTE;
};

// Google Analytics readings use the same windows and outcomes as Search Console.
export type CollectGa4Result = CollectGscResult;
