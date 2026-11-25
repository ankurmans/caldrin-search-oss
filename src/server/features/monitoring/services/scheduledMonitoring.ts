import { compareSides } from "@/server/features/ai-visibility/services/aiMeasurementCompare";
import { loadMeasurementSide } from "@/server/features/ai-visibility/services/aiMeasurementLoad";
import { describeError } from "@/server/lib/errors";
import {
  MonitoringRepository as repo,
  type NewAlert,
} from "../repositories/MonitoringRepository";
import type { AlertDetails } from "../types";
import { buildChangeAlerts, type LoadedSide } from "./monitoringChanges";
import { deliverAlerts } from "./monitoringEmail";
import { buildWeeklySummary, isoWeek } from "./monitoringWeekly";

// The daily monitoring pass. It only READS stored AI visibility answers and
// writes alerts: it never starts a collection and calls no provider.

const CHANGES_JOB = "ai_visibility_changes";
const WEEKLY_JOB = "ai_visibility_weekly_summary";
const MAX_ATTEMPTS = 3;
// How many earlier collection days to search for one measured like for like.
const DAYS_SEARCHED = 8;
const PROJECTS_PER_RUN = 500;
const RUN_DEADLINE_MS = 2 * 60_000;
const DAY_MS = 86_400_000;

type Scope = { projectId: string; organizationId: string };
type JobResult =
  | { status: "succeeded"; alertIds: string[] }
  | { status: "skipped"; reason: string };

type MonitoringReport = {
  projects: number;
  succeeded: number;
  skipped: number;
  failed: number;
  alreadyDone: number;
  alertsWritten: number;
  emailed: number;
};

const dayWindow = (day: string) => ({
  start: `${day}T00:00:00.000Z`,
  end: `${day}T23:59:59.999Z`,
});

async function writeAlert(
  scope: Scope,
  alert: Omit<
    NewAlert,
    "projectId" | "organizationId" | "createdAt" | "detailsJson"
  > & {
    details: AlertDetails;
  },
) {
  const { details, ...rest } = alert;
  return repo.insertAlert({
    ...rest,
    ...scope,
    detailsJson: JSON.stringify(details),
    createdAt: new Date().toISOString(),
  });
}

/**
 * Runs one job once per idempotency key. A key that succeeded or was skipped
 * is never run again; a failing key is retried on later passes up to
 * MAX_ATTEMPTS, and its first failure is surfaced as one run_failed alert.
 */
async function runJob(
  scope: Scope,
  job: string,
  period: string,
  report: MonitoringReport,
  work: () => Promise<JobResult>,
): Promise<string[]> {
  const idempotencyKey = `${scope.projectId}:${job}:${period}`;
  const existing = await repo.getJobRun(idempotencyKey);
  if (
    existing &&
    (existing.status !== "failed" || existing.attempt >= MAX_ATTEMPTS)
  ) {
    report.alreadyDone++;
    return [];
  }
  const attempt = (existing?.attempt ?? 0) + 1;
  const startedAt = new Date().toISOString();
  const save = (
    status: "succeeded" | "skipped" | "failed",
    reason: string | null,
  ) =>
    repo.saveJobRun({
      projectId: scope.projectId,
      job,
      idempotencyKey,
      status,
      reason,
      attempt,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  try {
    const result = await work();
    if (result.status === "skipped") {
      await save("skipped", result.reason);
      report.skipped++;
      return [];
    }
    await save("succeeded", null);
    report.succeeded++;
    report.alertsWritten += result.alertIds.length;
    return result.alertIds;
  } catch (error) {
    report.failed++;
    console.error("[monitoring] job failed", {
      idempotencyKey,
      attempt,
      error,
    });
    await save("failed", describeError(error).slice(0, 500));
    const alertId = await writeAlert(scope, {
      kind: "run_failed",
      title: "AI visibility monitoring could not run",
      body: [
        `The ${job === WEEKLY_JOB ? "weekly summary" : "change check"} for ${period} could not read the stored answers.`,
        `It is retried on later daily passes, up to ${MAX_ATTEMPTS} attempts in all.`,
        "No collection was started and no data was changed.",
      ].join("\n"),
      details: {
        conditions: null,
        metrics: [],
        attributionNote: null,
        job,
      },
      comparable: false,
      // Once per key, however many attempts fail.
      dedupeKey: `run_failed:${job}:${period}`,
    });
    if (alertId) report.alertsWritten++;
    return alertId ? [alertId] : [];
  }
}

async function compareLatestDay(
  scope: Scope,
  days: string[],
): Promise<JobResult> {
  const [latest, ...earlier] = days;
  const after = await loadMeasurementSide(scope.projectId, {
    window: dayWindow(latest),
  });
  for (const day of earlier) {
    const before: LoadedSide = await loadMeasurementSide(scope.projectId, {
      window: dayWindow(day),
    });
    const comparison = compareSides(
      before.side,
      after.side,
      before.truncated || after.truncated,
    );
    if (!comparison.comparable) continue;
    const versionId = after.side.promptSetVersionIds[0];
    const promptSetVersion = versionId
      ? await repo.getPromptSetVersionNumber(scope.projectId, versionId)
      : null;
    const drafts = buildChangeAlerts({
      comparison,
      before: { period: day, side: before },
      after: { period: latest, side: after },
      promptSetVersion,
    });
    const alertIds: string[] = [];
    for (const draft of drafts) {
      const id = await writeAlert(scope, { ...draft, comparable: true });
      if (id) alertIds.push(id);
    }
    return { status: "succeeded", alertIds };
  }
  // Quiet by design: a prompt-set, engine or market change writes nothing.
  return {
    status: "skipped",
    reason: `No earlier collection day measured like for like with ${latest}.`,
  };
}

async function weeklySummary(scope: Scope, now: Date): Promise<JobResult> {
  const summary = await buildWeeklySummary(scope.projectId, now);
  if (!summary)
    return { status: "skipped", reason: "No answered runs in the week." };
  const id = await writeAlert(scope, {
    kind: "weekly_summary",
    title: summary.title,
    body: summary.body,
    details: summary.details,
    comparable: summary.comparable,
    dedupeKey: `weekly_summary:${summary.period}`,
  });
  return { status: "succeeded", alertIds: id ? [id] : [] };
}

async function monitorProject(
  scope: Scope,
  now: Date,
  report: MonitoringReport,
) {
  const today = now.toISOString().slice(0, 10);
  const alertIds: string[] = [];
  // Only whole days: today's collection may still be running.
  const days = await repo.listCollectionDays(
    scope.projectId,
    `${today}T00:00:00.000Z`,
    DAYS_SEARCHED + 1,
  );
  // The period is the newest finished day, so a pass with no new day is a no-op.
  if (days.length >= 2)
    alertIds.push(
      ...(await runJob(scope, CHANGES_JOB, days[0], report, () =>
        compareLatestDay(scope, days),
      )),
    );
  const week = isoWeek(new Date(now.getTime() - 7 * DAY_MS)).label;
  alertIds.push(
    ...(await runJob(scope, WEEKLY_JOB, week, report, () =>
      weeklySummary(scope, now),
    )),
  );
  report.emailed += await deliverAlerts({ ...scope, alertIds });
}

/** Cron body: compare stored AI visibility data and write alerts. */
export async function runScheduledMonitoring(
  now: Date = new Date(),
): Promise<MonitoringReport> {
  const deadline = Date.now() + RUN_DEADLINE_MS;
  const report: MonitoringReport = {
    projects: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    alreadyDone: 0,
    alertsWritten: 0,
    emailed: 0,
  };
  for (const scope of await repo.listTrackedProjects(PROJECTS_PER_RUN)) {
    if (Date.now() >= deadline) break;
    report.projects++;
    try {
      await monitorProject(scope, now, report);
    } catch (error) {
      // One project failing outside a job (reading its days) must not stop the rest.
      report.failed++;
      console.error("[monitoring] project pass failed", {
        projectId: scope.projectId,
        error,
      });
    }
  }
  return report;
}
