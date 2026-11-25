import { sort } from "remeda";
import { billingPlan } from "@/shared/billing-plans";
import { SpendRepository } from "../repositories/SpendRepository";
import {
  checkAgainstLimits,
  hasUsdLimit,
  remainingUsd,
  validateLimits,
  validateUsd,
  windowStarts,
} from "../rules/spendRules";
import {
  SpendLimitRefusal,
  type SpendLimits,
  type SpendScope,
  type SpendSummary,
} from "../types";

export { SpendLimitRefusal };

// Constant, deliberately high: one draft is capped at 6000 output tokens, so
// this covers a mid-priced model with margin. It is an estimate, never a
// measurement; the real cost is recorded afterwards with recordCost.
export const LLM_DRAFT_ESTIMATED_USD = 0.15;

const SCHEDULED_PREFIX = "scheduled:";

async function getLimits(projectId: string): Promise<SpendLimits> {
  return (
    (await SpendRepository.getLimits(projectId)) ?? {
      dailyUsd: null,
      monthlyUsd: null,
      scheduledJobsPerDay: null,
    }
  );
}

async function setLimits(
  scope: SpendScope,
  limits: SpendLimits,
): Promise<SpendLimits> {
  validateLimits(limits);
  await SpendRepository.upsertLimits(scope.projectId, scope.userId, limits);
  return getLimits(scope.projectId);
}

async function getSpend(projectId: string): Promise<SpendSummary> {
  const { day, month } = windowStarts(new Date());
  const [todayUsd, monthUsd, todayByProvider, monthByProvider] =
    await Promise.all([
      SpendRepository.sumSince(projectId, day),
      SpendRepository.sumSince(projectId, month),
      SpendRepository.sumByProviderSince(projectId, day),
      SpendRepository.sumByProviderSince(projectId, month),
    ]);
  const byProvider = sort(
    [...monthByProvider.entries()].map(([provider, monthTotal]) => ({
      provider,
      todayUsd: todayByProvider.get(provider) ?? 0,
      monthUsd: monthTotal,
    })),
    (a, b) => b.monthUsd - a.monthUsd,
  );
  return { todayUsd, monthUsd, byProvider };
}

// The most recent cost recorded for one operation since the start of today
// (UTC, the same day boundary the daily limit uses), or null.
async function latestToday(projectId: string, operation: string) {
  const { day } = windowStarts(new Date());
  return SpendRepository.latestOperationSince(projectId, operation, day);
}

// What is left under the tightest USD limit, for showing before a paid run.
async function getRemainingUsd(projectId: string) {
  const [limits, spend] = await Promise.all([
    getLimits(projectId),
    getSpend(projectId),
  ]);
  return remainingUsd(limits, spend);
}

// A workspace on a hosted plan may spend up to the plan's monthly cap across
// all its projects on our provider keys. It is what keeps the plan's margin, so
// an operation with no estimate is refused rather than let through.
async function assertWithinPlanCap(
  scope: SpendScope,
  estimatedUsd: number | null,
  label: string,
): Promise<void> {
  const plan = billingPlan(
    await SpendRepository.getPlanKey(scope.organizationId),
  );
  if (!plan) return;
  if (estimatedUsd === null) {
    throw new SpendLimitRefusal(
      `${label} not run: this workspace's ${plan.name} plan has a monthly allowance and this operation has no cost estimate, so the allowance cannot be checked.`,
    );
  }
  validateUsd("estimatedUsd", estimatedUsd);
  const { month } = windowStarts(new Date());
  const spent = await SpendRepository.sumOrganizationSince(
    scope.organizationId,
    month,
  );
  if (spent + estimatedUsd > plan.providerCapUsd) {
    throw new SpendLimitRefusal(
      `${label} not run: it would pass this workspace's ${plan.name} plan allowance for the month (${spent.toFixed(2)} of ${plan.providerCapUsd.toFixed(2)} USD used). It renews next month; upgrade the plan or add your own keys to continue now.`,
    );
  }
}

// Call before any paid operation. estimatedUsd must be passed explicitly: null
// means "no estimate exists", which is refused whenever a USD limit is set,
// because the limit cannot be checked. No limit set = allowed. Any failure to
// read limits or spend refuses (fails closed) rather than letting spend through.
async function assertWithinLimits(
  scope: SpendScope,
  input: { estimatedUsd: number | null; provider: string; operation: string },
): Promise<void> {
  const label = `${input.provider} ${input.operation}`;
  try {
    await assertWithinPlanCap(scope, input.estimatedUsd, label);
    const limits = await SpendRepository.getLimits(scope.projectId);
    if (!hasUsdLimit(limits)) return;
    if (input.estimatedUsd === null) {
      throw new SpendLimitRefusal(
        `${label} not run: this project has a spend limit and this operation has no cost estimate, so the limit cannot be checked.`,
      );
    }
    validateUsd("estimatedUsd", input.estimatedUsd);
    const { day, month } = windowStarts(new Date());
    const [todayUsd, monthUsd] = await Promise.all([
      SpendRepository.sumSince(scope.projectId, day),
      SpendRepository.sumSince(scope.projectId, month),
    ]);
    checkAgainstLimits({
      limits,
      todayUsd,
      monthUsd,
      estimatedUsd: input.estimatedUsd,
      label,
    });
  } catch (error) {
    if (error instanceof SpendLimitRefusal) throw error;
    throw new SpendLimitRefusal(
      `${label} not run: spend limits could not be verified, so the operation was refused.`,
      { unverified: true },
    );
  }
}

async function recordCost(
  scope: SpendScope,
  input: {
    provider: string;
    operation: string;
    estimatedUsd?: number | null;
    costUsd: number;
    ledgerEntryId?: string | null;
  },
): Promise<string> {
  validateUsd("costUsd", input.costUsd);
  if (input.estimatedUsd != null)
    validateUsd("estimatedUsd", input.estimatedUsd);
  const ledgerEntryId = input.ledgerEntryId ?? null;
  if (
    ledgerEntryId &&
    !(await SpendRepository.ledgerEntryInProject(
      scope.projectId,
      ledgerEntryId,
    ))
  ) {
    throw new SpendLimitRefusal("That ledger entry is not in this project.");
  }
  return SpendRepository.insertCost({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    ledgerEntryId,
    provider: input.provider,
    operation: input.operation,
    estimatedUsd: input.estimatedUsd ?? null,
    costUsd: input.costUsd,
  });
}

// Counts today's recorded scheduled runs (UTC day) against scheduledJobsPerDay.
// Not atomic with recordScheduledRun: call recordScheduledRun immediately after
// this passes, before doing the work.
async function assertScheduledJobAllowed(
  scope: SpendScope,
  jobKind: string,
): Promise<void> {
  try {
    const limits = await SpendRepository.getLimits(scope.projectId);
    const max = limits?.scheduledJobsPerDay ?? null;
    if (max === null) return;
    const { day } = windowStarts(new Date());
    const used = await SpendRepository.countOperationPrefixSince(
      scope.projectId,
      SCHEDULED_PREFIX,
      day,
    );
    if (used >= max) {
      throw new SpendLimitRefusal(
        `Scheduled job "${jobKind}" not run: this project already ran ${used} scheduled jobs today (UTC) and its limit is ${max}.`,
      );
    }
  } catch (error) {
    if (error instanceof SpendLimitRefusal) throw error;
    throw new SpendLimitRefusal(
      `Scheduled job "${jobKind}" not run: scheduled-job limits could not be verified, so it was refused.`,
      { unverified: true },
    );
  }
}

async function recordScheduledRun(
  scope: SpendScope,
  jobKind: string,
  cost?: { provider?: string; costUsd?: number },
): Promise<string> {
  return recordCost(scope, {
    provider: cost?.provider ?? "scheduler",
    operation: `${SCHEDULED_PREFIX}${jobKind}`,
    costUsd: cost?.costUsd ?? 0,
  });
}

function estimateLlmDraftUsd() {
  return {
    estimatedUsd: LLM_DRAFT_ESTIMATED_USD,
    isEstimate: true as const,
    basis:
      "Fixed upper-bound estimate for one AI draft (6000 output tokens). The recorded cost is the provider's reported figure.",
  };
}

export const SpendService = {
  getLimits,
  setLimits,
  getSpend,
  getRemainingUsd,
  latestToday,
  assertWithinLimits,
  recordCost,
  assertScheduledJobAllowed,
  recordScheduledRun,
  estimateLlmDraftUsd,
};
