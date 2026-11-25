import { AttributionIdentityRepository as identity } from "../repositories/AttributionIdentityRepository";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { AttributionResultsRepository as results } from "../repositories/AttributionResultsRepository";
import { ensureModelRun } from "./attributionCredit";
import { drainAttribution } from "./attributionDrain";

const DEFAULT_LOOKBACK_DAYS = 90;

/**
 * Throws away everything derived for the project and queues every ledger
 * event to be derived again, in the order it arrived. The events themselves
 * are not touched, so this is how a new lookback window or a new source rule
 * is applied to history. Returns once the queue is drained as far as the
 * budget allows; a large ledger finishes on the next drains.
 */
export async function reprocessAttribution(
  projectId: string,
  options: { reason: string; userId?: string; budget?: number },
) {
  const settings = await ledger.getSettings(projectId);
  await ensureModelRun(
    projectId,
    settings?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    options.reason,
    options.userId,
  );
  await results.wipeDerived(projectId);
  await identity.wipe(projectId);
  await ledger.queueAllEvents(projectId);
  return drainAttribution(projectId, options.budget ?? 200);
}

/** Continues any project's queued events; used by the scheduled drain. */
export async function drainPendingProjects(budgetPerProject = 200) {
  let processed = 0;
  for (const projectId of await ledger.projectsWithPending())
    processed += (await drainAttribution(projectId, budgetPerProject))
      .processed;
  return processed;
}

const REJECTION_RETENTION_DAYS = 30;

/** Drops page views older than each project's retention, and old refusals. Conversions are kept. */
export async function pruneAttribution() {
  const now = Date.now();
  for (const { projectId, retentionDays } of await ledger.listAllSettings())
    await ledger.pruneEvents(
      projectId,
      "page_view",
      new Date(now - retentionDays * 86_400_000).toISOString(),
    );
  await ledger.pruneRejections(
    new Date(now - REJECTION_RETENTION_DAYS * 86_400_000).toISOString(),
  );
}
