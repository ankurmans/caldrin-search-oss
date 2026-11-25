import { usesAiWallet } from "@/server/lib/ai-wallet-scope";
import { env } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { workspaceSettings } from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import { getEnvValueSync } from "@/server/lib/runtime-env";
import { getWorkspaceMode, setWorkspaceMode } from "./credentials";

// A new signup runs on the deployment's keys until it has spent this much, then
// it must bring its own keys or upgrade. Override with TRIAL_BUDGET_USD.
const DEFAULT_TRIAL_BUDGET_USD = 2;

// A trial this close to its budget is over: nothing useful fits in the rest.
const TRIAL_END_MARGIN_USD = 0.05;

function trialBudgetUsd(): number {
  const value = Number(getEnvValueSync(env, "TRIAL_BUDGET_USD")?.trim());
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TRIAL_BUDGET_USD;
}

async function readSpentUsd(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ spent: workspaceSettings.trialSpentUsd })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.organizationId, organizationId))
    .limit(1);
  return row?.spent ?? 0;
}

type TrialState =
  | { phase: "none" }
  | { phase: "active"; spentUsd: number; budgetUsd: number }
  | { phase: "ended"; spentUsd: number; budgetUsd: number };

export async function getTrialState(
  organizationId: string,
): Promise<TrialState> {
  const mode = await getWorkspaceMode(organizationId);
  if (mode === "cloud") return { phase: "none" };
  const spentUsd = await readSpentUsd(organizationId);
  const budgetUsd = trialBudgetUsd();
  if (mode === "trial") return { phase: "active", spentUsd, budgetUsd };
  return spentUsd > 0
    ? { phase: "ended", spentUsd, budgetUsd }
    : { phase: "none" };
}

/**
 * Call before spending the deployment's keys for a workspace. A workspace that
 * is not on trial passes: its mode already decides whose keys it uses. A trial
 * that cannot cover the estimate is refused; the trial stays open for smaller
 * work unless the budget is spent.
 */
export async function assertTrialBudget(
  organizationId: string,
  estimatedUsd = 0,
): Promise<void> {
  if (
    usesAiWallet(organizationId) ||
    (await getWorkspaceMode(organizationId)) !== "trial"
  )
    return;
  const spentUsd = await readSpentUsd(organizationId);
  if (spentUsd + estimatedUsd > trialBudgetUsd()) {
    throw new AppError(
      "TRIAL_ENDED",
      "This is more than your free test run covers.",
    );
  }
}

/** Adds what a trial workspace actually spent; ends the trial when it is used up. */
export async function recordTrialSpend(
  organizationId: string,
  usd: number,
): Promise<void> {
  if (usd <= 0) return;
  if (
    usesAiWallet(organizationId) ||
    (await getWorkspaceMode(organizationId)) !== "trial"
  )
    return;
  const [row] = await db
    .update(workspaceSettings)
    .set({ trialSpentUsd: sql`${workspaceSettings.trialSpentUsd} + ${usd}` })
    .where(
      and(
        eq(workspaceSettings.organizationId, organizationId),
        eq(workspaceSettings.mode, "trial"),
      ),
    )
    .returning({ spent: workspaceSettings.trialSpentUsd });
  if (row && row.spent >= trialBudgetUsd() - TRIAL_END_MARGIN_USD) {
    await setWorkspaceMode(organizationId, "byok");
  }
}
