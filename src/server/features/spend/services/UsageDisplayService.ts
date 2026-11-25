import type { SpendLimits } from "../types";
import { getTrialState } from "@/server/features/workspace/trial";
import {
  getWorkspaceMode,
  type WorkspaceMode,
} from "@/server/features/workspace/credentials";

/**
 * What a workspace is shown about usage. Only a workspace on its own provider
 * keys pays the provider directly, so only it sees provider charges. Cloud
 * usage is part of the plan, and a free test run shows what is left of it.
 * Recording, limits and paid-run guards do not read this: it is presentation.
 */
export type UsageDisplay = {
  mode: WorkspaceMode;
  showProviderCosts: boolean;
  allowance: { remainingUsd: number; budgetUsd: number } | null;
};

type TrialPhase = Awaited<ReturnType<typeof getTrialState>>;

export function presentUsage(
  mode: WorkspaceMode,
  trial: TrialPhase,
): UsageDisplay {
  return {
    mode,
    showProviderCosts: mode === "byok",
    allowance:
      mode === "trial" && trial.phase === "active"
        ? {
            remainingUsd: Math.max(0, trial.budgetUsd - trial.spentUsd),
            budgetUsd: trial.budgetUsd,
          }
        : null,
  };
}

async function forOrganization(organizationId: string): Promise<UsageDisplay> {
  const [mode, trial] = await Promise.all([
    getWorkspaceMode(organizationId),
    getTrialState(organizationId),
  ]);
  return presentUsage(mode, trial);
}

/**
 * Money limits are only shown to a workspace that sees provider charges, so a
 * form that cannot show them must not clear them: the stored values stay.
 */
export function limitsToSave(
  display: UsageDisplay,
  stored: SpendLimits,
  requested: SpendLimits,
): SpendLimits {
  if (display.showProviderCosts) return requested;
  return {
    dailyUsd: stored.dailyUsd,
    monthlyUsd: stored.monthlyUsd,
    scheduledJobsPerDay: requested.scheduledJobsPerDay,
  };
}

/** The limits as the workspace may see them: no money amounts unless charges are shown. */
export function limitsToShow(display: UsageDisplay, stored: SpendLimits) {
  return {
    limits: display.showProviderCosts
      ? stored
      : { ...stored, dailyUsd: null, monthlyUsd: null },
    moneyLimitActive: stored.dailyUsd !== null || stored.monthlyUsd !== null,
  };
}

export const UsageDisplayService = { forOrganization };
