import {
  SpendService,
  SpendLimitRefusal,
} from "@/server/features/spend/services/SpendService";
import { AppError, describeError } from "@/server/lib/errors";
import { creditsToUsd } from "@/shared/credits";
import { computeNextCheckAt } from "@/shared/rank-tracking";
import { LocalSeoRepository as repo } from "../repositories/LocalSeoRepository";
import { checkCostCredits, LocalSeoService } from "./LocalSeoService";

const SCHEDULED_JOB = "local_rank";
const TICK_DEADLINE_MS = 2 * 60_000;

/** Cron body: start a grid check for every local tracker whose schedule is due. */
export async function runScheduledLocalChecks() {
  const deadline = Date.now() + TICK_DEADLINE_MS;
  let started = 0;
  for (const { tracker, organizationId } of await repo.listDueTrackers(
    new Date().toISOString(),
  )) {
    if (Date.now() >= deadline) break;
    // Unreachable: the due query only returns trackers with a schedule.
    if (!tracker.scheduleInterval || !tracker.nextCheckAt) continue;
    // Move the schedule on before starting, so a tracker that fails, is
    // skipped or is busy does not stay due and crowd out the rest.
    const next = computeNextCheckAt(
      tracker.scheduleInterval,
      tracker.nextCheckAt,
    );
    const skip = (reason: string) =>
      repo
        .setSchedule(tracker.projectId, tracker.id, {
          scheduleInterval: tracker.scheduleInterval,
          nextCheckAt: next,
          lastSkipReason: reason,
        })
        .catch(() => undefined);
    try {
      if (!(await repo.claimDueTracker(tracker.id, tracker.nextCheckAt, next)))
        continue;
      const keywords = await repo.getKeywords(tracker.id);
      if (!keywords.length) {
        await skip("No keywords to check.");
        continue;
      }
      if (await repo.getActiveCheck(tracker.projectId, tracker.id)) {
        await skip("A check was already running.");
        continue;
      }
      const customer = {
        organizationId,
        userId: "system",
        userEmail: "system@caldrin.co",
        projectId: tracker.projectId,
      };
      const costCredits = checkCostCredits(tracker, keywords.length);
      const estimatedUsd = creditsToUsd(costCredits);
      await SpendService.assertScheduledJobAllowed(customer, SCHEDULED_JOB);
      await SpendService.assertWithinLimits(customer, {
        estimatedUsd,
        provider: "dataforseo",
        operation: `scheduled:${SCHEDULED_JOB}`,
      });
      await LocalSeoService.startCheck(
        {
          projectId: tracker.projectId,
          trackerId: tracker.id,
          requestId: crypto.randomUUID(),
          maxCostCredits: costCredits,
        },
        customer,
      );
      await SpendService.recordCost(customer, {
        provider: "dataforseo",
        operation: `scheduled:${SCHEDULED_JOB}`,
        estimatedUsd,
        costUsd: estimatedUsd,
      });
      started++;
    } catch (error) {
      if (error instanceof SpendLimitRefusal || error instanceof AppError) {
        await skip(error.message);
        continue;
      }
      console.error("[local-seo] scheduled check failed to start", {
        trackerId: tracker.id,
        error: describeError(error),
      });
    }
  }
  return { started };
}
