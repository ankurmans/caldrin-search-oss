import { reconcileStuckExecutions } from "@/server/features/content/services/shopifyReconcile";
import { Ga4ConnectionRepository } from "@/server/features/ga4/repositories/Ga4ConnectionRepository";
import { SpendRepository } from "@/server/features/spend/repositories/SpendRepository";
import {
  SpendLimitRefusal,
  SpendService,
} from "@/server/features/spend/services/SpendService";
import { ScheduledLedgerRepository } from "../repositories/ScheduledLedgerRepository";
import type { CollectGscResult, LedgerEntry } from "../types";
import { collectGa4Observations } from "./ga4Observations";
import { collectGscObservations } from "./gscObservations";

// The daily performance loop. It acts as the system: the cron has no signed-in
// person, so it never writes a user id of its own. SpendScope wants a userId
// field, but recordCost and the scheduled-job count only read the project and
// organization; the placeholder is never stored.
//
// Every job is counted against the project's scheduled-jobs-per-day limit. A
// project at its limit is skipped and the skip is written down, once a day.
// Nothing here calls a paid API or writes to Shopify.

const SYSTEM_ACTOR = "system";
const GSC_JOB = "ledger_gsc";
const GA4_JOB = "ledger_ga4";
const RECONCILE_JOB = "shopify_reconcile";
const SKIPPED_LIMIT_OPERATION = "skipped:scheduled_limit";

const DAY_MS = 86_400_000;
// Search Console needs the change to be at least a week old (gscWindows.ts).
const MIN_FOLLOW_UP_DAYS = 7;
const STUCK_AFTER_MINUTES = 15;
// A reading that keeps coming back empty or unavailable is retried once a day
// for a week, then left alone; its outcome rows remain as the record.
const MAX_ATTEMPTS_PER_ENTRY = 7;
const ENTRIES_SCANNED_PER_PASS = 200;
const JOBS_PER_PASS = 50;
const PROJECTS_RECONCILED_PER_RUN = 100;
const RUN_DEADLINE_MS = 2 * 60_000;

type PassReport = {
  attempted: number;
  // Follow-up outcome => count: recorded, already_recorded, no_data,
  // too_early, unavailable, refused, failed.
  outcomes: Record<string, number>;
  skippedForLimit: number;
  // Due, but left for tomorrow because the run hit its batch size or deadline.
  deferred: number;
  // GA4 only: projects without a Google Analytics connection are not a job.
  notConnected: number;
};

export type ScheduledLedgerReport = {
  reconcile: {
    projects: number;
    skippedForLimit: number;
    failed: number;
    checked: number;
    markedExecuted: number;
    markedFailed: number;
    needsReview: number;
  };
  gsc: PassReport;
  ga4: PassReport;
  projectsAtLimit: string[];
};

type RunState = {
  now: Date;
  deadline: number;
  atLimit: Set<string>;
  ga4Connected: Map<string, boolean>;
};

type Scope = { projectId: string; organizationId: string; userId: string };

function emptyPass(): PassReport {
  return {
    attempted: 0,
    outcomes: {},
    skippedForLimit: 0,
    deferred: 0,
    notConnected: 0,
  };
}

function scopeOf(row: { projectId: string; organizationId: string }): Scope {
  return {
    projectId: row.projectId,
    organizationId: row.organizationId,
    userId: SYSTEM_ACTOR,
  };
}

function count(pass: PassReport, outcome: string) {
  pass.outcomes[outcome] = (pass.outcomes[outcome] ?? 0) + 1;
}

// A change is due once the plan's window has elapsed, and never before the
// source can have a follow-up reading at all.
function isDue(entry: LedgerEntry, now: Date): boolean {
  const executedMs = Date.parse(entry.executedAt ?? "");
  if (Number.isNaN(executedMs)) return false;
  const days = Math.max(
    entry.measurementWindowDays ?? MIN_FOLLOW_UP_DAYS,
    MIN_FOLLOW_UP_DAYS,
  );
  return executedMs + days * DAY_MS <= now.getTime();
}

// Counts the job against the project's daily limit, or says no. The first
// refusal of the day is recorded as a zero-cost row (a prefix the job count
// does not match); the rest of that project's jobs are skipped without
// another row.
async function admit(
  run: RunState,
  scope: Scope,
  jobKind: string,
): Promise<boolean> {
  if (run.atLimit.has(scope.projectId)) return false;
  try {
    await SpendService.assertScheduledJobAllowed(scope, jobKind);
  } catch (error) {
    if (!(error instanceof SpendLimitRefusal)) throw error;
    run.atLimit.add(scope.projectId);
    const today = run.now.toISOString().slice(0, 10);
    const alreadyRecorded = await SpendRepository.countOperationPrefixSince(
      scope.projectId,
      SKIPPED_LIMIT_OPERATION,
      today,
    );
    if (alreadyRecorded === 0) {
      await SpendService.recordCost(scope, {
        provider: "scheduler",
        operation: `${SKIPPED_LIMIT_OPERATION}:${jobKind}`,
        costUsd: 0,
      });
    }
    console.warn("[ledger] scheduled jobs skipped for limit", {
      projectId: scope.projectId,
      reason: error.message,
    });
    return false;
  }
  await SpendService.recordScheduledRun(scope, jobKind);
  return true;
}

async function recordOutcome(
  scope: Scope,
  jobKind: string,
  entryId: string,
  tag: string,
) {
  await SpendService.recordCost(scope, {
    provider: "scheduler",
    operation: `outcome:${jobKind}:${tag}`,
    costUsd: 0,
    ledgerEntryId: entryId,
  });
}

async function hasGa4(run: RunState, projectId: string): Promise<boolean> {
  const known = run.ga4Connected.get(projectId);
  if (known !== undefined) return known;
  const connected = !!(await Ga4ConnectionRepository.getByProjectId(projectId));
  run.ga4Connected.set(projectId, connected);
  return connected;
}

async function measurementPass(
  run: RunState,
  input: {
    jobKind: string;
    source: "gsc" | "ga4";
    collect: (entry: LedgerEntry) => Promise<CollectGscResult>;
  },
): Promise<PassReport> {
  const { jobKind, source, collect } = input;
  const pass = emptyPass();
  const entries = await ScheduledLedgerRepository.listUnmeasuredEntries({
    source,
    outcomePrefix: `outcome:${jobKind}:`,
    executedBefore: new Date(
      run.now.getTime() - MIN_FOLLOW_UP_DAYS * DAY_MS,
    ).toISOString(),
    today: run.now.toISOString().slice(0, 10),
    maxAttempts: MAX_ATTEMPTS_PER_ENTRY,
    scan: ENTRIES_SCANNED_PER_PASS,
  });
  for (const entry of entries) {
    if (!isDue(entry, run.now)) continue;
    if (pass.attempted >= JOBS_PER_PASS || Date.now() >= run.deadline) {
      pass.deferred += 1;
      continue;
    }
    if (source === "ga4" && !(await hasGa4(run, entry.projectId))) {
      pass.notConnected += 1;
      continue;
    }
    const scope = scopeOf(entry);
    try {
      if (!(await admit(run, scope, jobKind))) {
        pass.skippedForLimit += 1;
        continue;
      }
    } catch (error) {
      // The limit could not be counted: run nothing for this entry.
      console.error("[ledger] scheduled job admission failed", error);
      count(pass, "failed");
      continue;
    }
    pass.attempted += 1;
    try {
      const result = await collect(entry);
      count(pass, result.followUp.status);
      await recordOutcome(
        scope,
        jobKind,
        entry.id,
        `${result.followUp.status}:baseline_${result.baseline.status}`,
      );
    } catch (error) {
      // One entry failing must not stop the rest. A refusal is the entry's own
      // state (for example no execution time); anything else is a fault.
      const tag = error instanceof Error ? error.name : "unknown";
      const outcome = tag === "LedgerRefusal" ? "refused" : "failed";
      count(pass, outcome);
      if (outcome === "failed") {
        console.error("[ledger] scheduled measurement failed", {
          jobKind,
          entryId: entry.id,
          error,
        });
      }
      try {
        await recordOutcome(scope, jobKind, entry.id, outcome);
      } catch (recordError) {
        console.error("[ledger] could not record job outcome", recordError);
      }
    }
  }
  return pass;
}

async function reconcilePass(run: RunState) {
  const report: ScheduledLedgerReport["reconcile"] = {
    projects: 0,
    skippedForLimit: 0,
    failed: 0,
    checked: 0,
    markedExecuted: 0,
    markedFailed: 0,
    needsReview: 0,
  };
  // SQLite's own timestamp format, which a date-time prefix matches on both
  // dialects.
  const cutoff = new Date(run.now.getTime() - STUCK_AFTER_MINUTES * 60_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const projects =
    await ScheduledLedgerRepository.listProjectsWithStuckExecutions(
      cutoff,
      PROJECTS_RECONCILED_PER_RUN,
    );
  for (const project of projects) {
    if (Date.now() >= run.deadline) break;
    try {
      if (!(await admit(run, scopeOf(project), RECONCILE_JOB))) {
        report.skippedForLimit += 1;
        continue;
      }
      const result = await reconcileStuckExecutions({
        olderThanMinutes: STUCK_AFTER_MINUTES,
        projectId: project.projectId,
      });
      report.projects += 1;
      report.checked += result.checked;
      report.markedExecuted += result.markedExecuted;
      report.markedFailed += result.markedFailed;
      report.needsReview += result.needsReview;
    } catch (error) {
      report.failed += 1;
      console.error("[ledger] stuck-execution reconcile failed", {
        projectId: project.projectId,
        error,
      });
    }
  }
  return report;
}

/** Cron body: reconcile stuck executions, then take due follow-up readings. */
export async function runScheduledLedgerJobs(
  now: Date = new Date(),
): Promise<ScheduledLedgerReport> {
  const run: RunState = {
    now,
    deadline: Date.now() + RUN_DEADLINE_MS,
    atLimit: new Set(),
    ga4Connected: new Map(),
  };
  const reconcile = await reconcilePass(run);
  const gsc = await measurementPass(run, {
    jobKind: GSC_JOB,
    source: "gsc",
    collect: (entry) => collectGscObservations(entry.projectId, entry, now),
  });
  // Optional second step: only projects with Google Analytics connected.
  const ga4 = await measurementPass(run, {
    jobKind: GA4_JOB,
    source: "ga4",
    collect: (entry) =>
      collectGa4Observations({
        projectId: entry.projectId,
        entryId: entry.id,
        now,
      }),
  });
  return { reconcile, gsc, ga4, projectsAtLimit: [...run.atLimit] };
}
