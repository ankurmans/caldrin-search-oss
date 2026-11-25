import { expiredWalletRuns } from "@/server/features/billing/wallet";
import { settleWalletAnswers } from "./aiVisibilityRunOutcome";
import { AppError, describeError } from "@/server/lib/errors";
import { pruneAiVisibility } from "./aiVisibilityRetention";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { AiVisibilityError } from "./aiVisibilityErrors";
import { activeAiPrompts, trackerEngines } from "./aiVisibilityConfiguration";
import { startMarketRuns, trackerMarkets } from "./aiVisibilityRuns";
import { computeNextCheckAt } from "@/shared/rank-tracking";
import {
  SpendLimitRefusal,
  SpendService,
} from "@/server/features/spend/services/SpendService";
import { aiCostForAnswers } from "./aiVisibilityCost";

const SCHEDULED_JOB = "ai_visibility";

// Answers admitted per tick. Like rank tracking's task-unit budget, it keeps
// task_get polling under DataForSEO's 2,000 requests a minute; the first start
// of a tick is always admitted so a large tracker never starves. Trackers past
// the budget stay due for the next tick, oldest first.
const SCHEDULED_ANSWER_BUDGET = 1000;
const TICK_DEADLINE_MS = 2 * 60_000;

/** Cron body: start a check for every due tracker. */
export async function runScheduledAiVisibility() {
  try {
    for (const { runId } of await expiredWalletRuns())
      if (!runId.startsWith("claim:")) await settleWalletAnswers(runId);
    await pruneAiVisibility();
  } catch (error) {
    console.error("[ai-visibility] retention sweep failed", error);
  }
  const deadline = Date.now() + TICK_DEADLINE_MS;
  let started = 0;
  let answersStarted = 0;
  for (const { tracker, organizationId } of await repo.listDue(
    new Date().toISOString(),
  )) {
    if (Date.now() >= deadline) break;
    // Unreachable: the due query only returns trackers with a next check.
    if (!tracker.nextCheckAt) continue;
    const observedNextCheckAt = tracker.nextCheckAt;
    try {
      const config = await repo.getConfiguration(tracker.projectId);
      if (!config) continue;
      const markets = (await trackerMarkets(config)).length;
      const answers =
        activeAiPrompts(config).length *
        trackerEngines(tracker).length *
        markets;
      if (started > 0 && answersStarted + answers > SCHEDULED_ANSWER_BUDGET)
        break;
      // Advance the schedule before starting, so a tracker that fails or is
      // busy moves on instead of staying due and crowding out the rest.
      const claimed = await repo.claimDueTracker({
        trackerId: tracker.id,
        observedNextCheckAt,
        values: {
          nextCheckAt: computeNextCheckAt(
            tracker.scheduleInterval,
            observedNextCheckAt,
          ),
          lastSkipReason: null,
        },
      });
      if (!claimed) continue;
      // The project's spend limits and daily scheduled-job cap apply to paid
      // collections nobody clicked. A refusal skips this check; the schedule
      // has already moved on.
      const spendScope = {
        projectId: tracker.projectId,
        organizationId,
        userId: "system",
      };
      const engines = trackerEngines(tracker);
      const { providerCostUsd } = aiCostForAnswers(
        Array.from({ length: markets }, () =>
          activeAiPrompts(config).flatMap(() => engines),
        ).flat(),
        "queued",
      );
      await SpendService.assertScheduledJobAllowed(spendScope, SCHEDULED_JOB);
      await SpendService.assertWithinLimits(spendScope, {
        estimatedUsd: providerCostUsd,
        provider: "dataforseo",
        operation: `scheduled:${SCHEDULED_JOB}`,
      });
      // Always queued: a baseline collects live only when a user starts it
      // (onboarding or turning on the schedule) and waits for the answers.
      await startMarketRuns(config, "scheduled", {
        organizationId,
        userId: "system",
        userEmail: "system@caldrin.co",
        projectId: tracker.projectId,
      });
      // Per-answer charges are not reported back per run, so the estimate is
      // recorded: limits then count this run rather than missing it.
      await SpendService.recordCost(spendScope, {
        provider: "dataforseo",
        operation: `scheduled:${SCHEDULED_JOB}`,
        estimatedUsd: providerCostUsd,
        costUsd: providerCostUsd,
      });
      started++;
      answersStarted += answers;
    } catch (error) {
      // startRun records a credits skip on the tracker.
      if (
        error instanceof AppError &&
        (error.code === "TRIAL_ENDED" || error.code === "WALLET_BALANCE_LOW")
      )
        continue;
      if (error instanceof SpendLimitRefusal) {
        await repo
          .updateTracker(tracker.id, { lastSkipReason: error.message })
          .catch(() => undefined);
        continue;
      }
      if (!(error instanceof AiVisibilityError))
        console.error("[ai-visibility] scheduled check failed to start", {
          trackerId: tracker.id,
          error: describeError(error),
        });
      await repo
        .updateTracker(tracker.id, {
          lastSkipReason:
            error instanceof AiVisibilityError
              ? error.message
              : "The scheduled check could not start.",
        })
        .catch(() => undefined);
    }
  }
}
