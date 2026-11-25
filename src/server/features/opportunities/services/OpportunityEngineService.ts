import { AppError } from "@/server/lib/errors";
import { buildFreeCandidates, rankAndCap } from "../rules/buildCandidates";
import { keywordGapCandidates } from "../rules/keywordGapRules";
import {
  PAID_OPERATION,
  PAID_PROVIDER,
  shouldRunPaid,
} from "../rules/paidGuard";
import { coveredRules, ruleKindOf } from "../rules/reconcileRules";
import {
  OpportunityRepository,
  type OpportunityFilters,
} from "../repositories/OpportunityRepository";
import {
  OpportunityRefusal,
  type EngineInputs,
  type OpportunityCandidate,
  type OpportunityScope,
  type RunOptions,
  type RunSummary,
} from "../types";
import { loadEngineInputs } from "./loadEngineInputs";

const DEFAULT_MAX_OPPORTUNITIES = 150;
const DEFAULT_PAID_KEYWORD_LIMIT = 200;

async function resolveInputs(
  scope: OpportunityScope,
  options: RunOptions,
  now: Date,
): Promise<EngineInputs> {
  const { inputs } = options;
  if (typeof inputs === "function") return inputs();
  if (inputs) return inputs;
  return loadEngineInputs(scope.projectId, now);
}

// Runs the paid keyword-gap rule: limits are checked before the read and the
// cost is recorded after it, whatever the read returned.
async function runPaidKeywordGaps(
  scope: OpportunityScope,
  options: RunOptions,
  inputs: EngineInputs,
  observedAt: string,
): Promise<{
  candidates: OpportunityCandidate[];
  costUsd: number | null;
  skipped: string | null;
}> {
  const { paid, spendGate, recordCost } = options;
  if (!paid || !spendGate || !recordCost) {
    throw new OpportunityRefusal("Paid rule was not configured.");
  }
  if (!inputs.gsc || inputs.gsc.source !== "gsc") {
    return {
      candidates: [],
      costUsd: null,
      skipped:
        "Keyword gaps compare against live Search Console queries, which are not available, so no paid read was made.",
    };
  }
  await spendGate.assertWithinLimits(scope, {
    estimatedUsd: paid.estimatedUsd,
    provider: PAID_PROVIDER,
    operation: PAID_OPERATION,
  });
  const result = await paid.source.fetchCompetitorKeywords({
    competitorDomains: paid.competitorDomains,
    limit: paid.limit ?? DEFAULT_PAID_KEYWORD_LIMIT,
  });
  // The provider's own figure when it reports one, else the estimate that was
  // checked against the limits (conservative, so spend is never under-counted).
  const costUsd = result.costUsd ?? paid.estimatedUsd;
  await recordCost(scope, {
    provider: PAID_PROVIDER,
    operation: PAID_OPERATION,
    estimatedUsd: paid.estimatedUsd,
    costUsd,
  });
  return {
    candidates: keywordGapCandidates(inputs, result, observedAt),
    costUsd,
    skipped: null,
  };
}

async function run(
  scope: OpportunityScope,
  options: RunOptions = {},
): Promise<RunSummary> {
  // Refuse before reading anything when the paid rule is requested unsafely.
  const paidWanted = shouldRunPaid(options);
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const inputs = await resolveInputs(scope, options, now);

  const free = buildFreeCandidates(inputs, observedAt, {
    maxNoAction: options.maxNoAction,
  });
  const skipped = [...free.skipped];
  const candidates = [...free.candidates];
  const paidSummary: RunSummary["paid"] = {
    ran: false,
    estimatedUsd: options.paid?.estimatedUsd ?? null,
    costUsd: null,
  };
  if (paidWanted) {
    const paid = await runPaidKeywordGaps(scope, options, inputs, observedAt);
    candidates.push(...paid.candidates);
    paidSummary.ran = paid.skipped === null;
    paidSummary.costUsd = paid.costUsd;
    if (paid.skipped)
      skipped.push({ rule: "keyword_gaps", reason: paid.skipped });
  }

  const final = rankAndCap(
    candidates,
    options.maxOpportunities ?? DEFAULT_MAX_OPPORTUNITIES,
  );
  const byAction: Record<string, number> = {};
  for (const candidate of final) {
    await OpportunityRepository.upsertCandidate(scope, candidate);
    byAction[candidate.action] = (byAction[candidate.action] ?? 0) + 1;
  }
  const covered = coveredRules(inputs, paidSummary.ran);
  const reconciled = await OpportunityRepository.reconcileStale(
    scope.projectId,
    {
      producedKeys: new Set(final.map((c) => c.dedupeKey)),
      isCovered: (key) => covered.has(ruleKindOf(key)),
      observedAt,
    },
  );
  return {
    observedAt,
    stored: final.length,
    byAction,
    skipped,
    paid: paidSummary,
    reconciled,
  };
}

// Each row carries how many evidence rows back it, so a list can show that
// every recommendation is inspectable.
async function list(projectId: string, filters?: OpportunityFilters) {
  const rows = await OpportunityRepository.listOpportunities(
    projectId,
    filters,
  );
  const counts = await OpportunityRepository.countEvidence(
    projectId,
    rows.map((r) => r.id),
  );
  const notFound = await OpportunityRepository.listNotFoundIds(projectId);
  return rows.map((row) => ({
    ...row,
    evidenceCount: counts.get(row.id) ?? 0,
    noLongerFound: notFound.has(row.id),
  }));
}

async function getDetail(projectId: string, id: string) {
  const detail = await OpportunityRepository.getOpportunityDetail(
    projectId,
    id,
  );
  if (!detail) throw new AppError("NOT_FOUND", "Opportunity not found.");
  const notFound = await OpportunityRepository.listNotFoundIds(projectId);
  return { ...detail, noLongerFound: notFound.has(id) };
}

async function setStatus(
  projectId: string,
  id: string,
  status: "open" | "briefed" | "dismissed",
) {
  const updated = await OpportunityRepository.setStatus(projectId, id, status);
  if (!updated) throw new AppError("NOT_FOUND", "Opportunity not found.");
  return getDetail(projectId, id);
}

export const OpportunityEngineService = {
  run,
  list,
  getDetail,
  setStatus,
};
