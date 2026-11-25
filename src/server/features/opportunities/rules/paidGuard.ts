import {
  OpportunityRefusal,
  type PaidKeywordGapRequest,
  type RecordCost,
  type SpendGate,
} from "../types";

export const PAID_PROVIDER = "dataforseo";
export const PAID_OPERATION = "opportunity_keyword_gap";

// The paid rule runs only on an explicit yes, with an estimate to check against
// the project's limits and a way to record what it cost. Anything missing is a
// refusal, so a paid call can never happen by default or by accident.
export function shouldRunPaid(input: {
  allowPaid?: boolean;
  paid?: PaidKeywordGapRequest;
  spendGate?: SpendGate;
  recordCost?: RecordCost;
}): boolean {
  const { allowPaid, paid, spendGate, recordCost } = input;
  if (!paid) return false;
  if (allowPaid !== true) {
    throw new OpportunityRefusal(
      `Competitor keyword gaps use paid DataForSEO data (estimated $${paid.estimatedUsd.toFixed(2)}). Nothing was fetched; run again with allowPaid to approve the spend.`,
    );
  }
  if (!Number.isFinite(paid.estimatedUsd) || paid.estimatedUsd < 0) {
    throw new OpportunityRefusal(
      "The paid keyword-gap rule needs a non-negative cost estimate. Nothing was fetched.",
    );
  }
  if (paid.competitorDomains.length === 0) {
    throw new OpportunityRefusal(
      "The paid keyword-gap rule needs at least one competitor domain. Nothing was fetched.",
    );
  }
  if (!spendGate || !recordCost) {
    throw new OpportunityRefusal(
      "Spend limits could not be checked, so the paid rule did not run. Nothing was fetched.",
    );
  }
  return true;
}
