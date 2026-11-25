import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { AiVisibilityError } from "./aiVisibilityErrors";
import { aiScope } from "./aiVisibilityConfiguration";
import {
  aiEngineUsesModelApi,
  AI_ENGINE_LABELS,
  AI_LIVE_RECORD_COST_USD,
  AI_RECORD_COST_USD,
  type AiCostEstimate,
  type AiEngine,
} from "@/shared/ai-visibility";
import { ESTIMATED_ANSWER_USD } from "@/server/lib/llm-search/pricing";
import { creditsForProviderUsd } from "@/shared/credits";
import { scheduledChecksPerMonth } from "@/shared/rank-tracking";
import type { EstimateAiCostInput } from "@/types/schemas/ai-visibility";
import { projectPatch } from "./aiVisibilityMutation";
import {
  hasAiCollectionAccess,
  walletAccount,
} from "@/server/features/billing/wallet";
import { currentWorkspaceId } from "@/server/lib/workspace-scope";
import { walletCreditsPerAnswer } from "@/shared/wallet-pricing";

/**
 * Raw DataForSEO USD for one answer. Claude and Perplexity always use the
 * model API. The other engines are live on Run now and queued otherwise.
 */
function aiAnswerUsd(engine: AiEngine, mode: "live" | "queued") {
  if (aiEngineUsesModelApi(engine)) return ESTIMATED_ANSWER_USD[engine];
  return mode === "live" ? AI_LIVE_RECORD_COST_USD : AI_RECORD_COST_USD;
}

/** The cost of a check, given one engine per answer. */
export function aiCostForAnswers(engines: AiEngine[], mode: "live" | "queued") {
  let providerUsd = 0;
  for (const engine of engines) providerUsd += aiAnswerUsd(engine, mode);
  const costUsd = Math.round(providerUsd * 1e6) / 1e6;
  return {
    providerCostUsd: costUsd,
    costCredits: creditsForProviderUsd(costUsd),
    costUsd,
  };
}

export async function estimateCost(
  input: EstimateAiCostInput,
): Promise<AiCostEstimate> {
  const current = await repo.getConfiguration(input.projectId);
  const config = input.patch
    ? (await projectPatch(input.projectId, input.patch, current)).rows
    : current;
  if (!config)
    throw new AiVisibilityError(
      "TRACKER_REQUIRED",
      "Set your project's website and pass proposed prompts, or save tracking before estimating.",
    );
  const scope = aiScope(config, input.promptIds);
  const answers = scope.prompts.flatMap(() => scope.engines);
  // Each extra market is another run on every scheduled check; a one-off
  // check collects one market.
  const marketCount =
    1 + (current ? (await repo.listMarkets(current.tracker.id)).length : 0);
  const scheduledAnswers = Array.from(
    { length: marketCount },
    () => answers,
  ).flat();
  const cost = aiCostForAnswers(scheduledAnswers, "queued");
  const runNow = aiCostForAnswers(answers, "live");
  const liveEngines = scope.engines.filter(aiEngineUsesModelApi);
  const scheduleInterval =
    input.scheduleInterval ?? current?.tracker.scheduleInterval ?? "weekly";
  const checksPerMonth = scheduledChecksPerMonth(scheduleInterval);
  const scheduledCredits = scheduledAnswers.reduce(
    (sum, engine) => sum + walletCreditsPerAnswer(engine, "queued"),
    0,
  );
  const organizationId = currentWorkspaceId();
  const wallet = organizationId ? await walletAccount(organizationId) : null;
  return {
    promptCount: scope.prompts.length,
    engineCount: scope.engines.length,
    observations: scheduledAnswers.length,
    marketCount,
    ...cost,
    runNowCostUsd: runNow.costUsd,
    runNowCostCredits: runNow.costCredits,
    wallet: {
      enabled: wallet?.enabled ?? false,
      available: wallet?.available ?? 0,
      scheduledCredits,
      monthlyCredits: scheduledCredits * checksPerMonth,
      runNowCredits: answers.reduce(
        (sum, engine) => sum + walletCreditsPerAnswer(engine, "live"),
        0,
      ),
    },
    scheduleInterval,
    checksPerMonth,
    monthlyCostUsd: Math.round(cost.costUsd * checksPerMonth * 1e6) / 1e6,
    currency: "USD",
    warnings: [
      "Cost estimates what your provider account charges.",
      `One fresh answer per prompt, engine and market. The ${scheduleInterval} estimate assumes ${checksPerMonth} ${checksPerMonth === 1 ? "check" : "checks"} per month.`,
      ...(liveEngines.length
        ? [
            `${liveEngines.map((e) => AI_ENGINE_LABELS[e]).join(" and ")} ${liveEngines.length === 1 ? "uses" : "use"} live API pricing, which costs more per answer.`,
          ]
        : []),
      ...(!(await hasAiCollectionAccess())
        ? [
            "DataForSEO is not configured on this server. Setup is available; collection needs an operator to add its API key.",
          ]
        : []),
    ],
  };
}
