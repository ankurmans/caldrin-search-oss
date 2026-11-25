import { and, asc, eq, isNotNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { changeLedgerEntries } from "@/db/schema";
import type { LedgerEntry, LedgerObservation } from "../types";

// Reads for the scheduled ledger jobs. They look across projects (the cron has
// no project), but every row carries its own projectId and organizationId and
// every later call is scoped by them.

// provider_costs rows double as the scheduler's job log: an entry's outcome
// rows say when it was last tried and how often. created_at is text on both
// dialects and starts with the UTC date, so comparing against a date prefix
// with >= is correct on either format (see spendRules.windowStarts).
function attemptsOf(operationPrefix: string) {
  return sql`SELECT 1 FROM provider_costs
    WHERE provider_costs.ledger_entry_id = change_ledger_entries.id
      AND provider_costs.operation LIKE ${`${operationPrefix}%`}`;
}

// Executed, published changes that have a measurement plan and no follow-up
// reading from `source` yet, minus entries already tried today or tried
// `maxAttempts` times. Oldest first. Whether the plan's window has elapsed is
// decided by the caller; this only bounds the scan.
async function listUnmeasuredEntries(input: {
  source: LedgerObservation["source"];
  outcomePrefix: string;
  executedBefore: string;
  today: string;
  maxAttempts: number;
  scan: number;
}): Promise<LedgerEntry[]> {
  const attempts = attemptsOf(input.outcomePrefix);
  return (
    db
      .select()
      .from(changeLedgerEntries)
      .where(
        and(
          eq(changeLedgerEntries.status, "executed"),
          eq(changeLedgerEntries.publicationStatus, "published"),
          isNotNull(changeLedgerEntries.targetUrl),
          isNotNull(changeLedgerEntries.executedAt),
          isNotNull(changeLedgerEntries.measurementWindowDays),
          lte(changeLedgerEntries.executedAt, input.executedBefore),
          sql`NOT EXISTS (
          SELECT 1 FROM change_ledger_observations
          WHERE change_ledger_observations.entry_id = change_ledger_entries.id
            AND change_ledger_observations.phase = 'follow_up'
            AND change_ledger_observations.source = ${input.source}
        )`,
          sql`NOT EXISTS (${attempts} AND provider_costs.created_at >= ${input.today})`,
          sql`(SELECT count(*) FROM (${attempts}) AS tried) < ${input.maxAttempts}`,
        ),
      )
      // Taken in turns across projects: entries that cannot be measured yet stay
      // in the list, and must not hide other projects' entries.
      .orderBy(
        sql`row_number() over (partition by ${changeLedgerEntries.projectId} order by ${changeLedgerEntries.executedAt}, ${changeLedgerEntries.id})`,
        asc(changeLedgerEntries.executedAt),
        asc(changeLedgerEntries.id),
      )
      .limit(input.scan)
  );
}

// Projects with a change that has sat in "executing" since before `cutoff`
// (SQLite's "YYYY-MM-DD HH:MM:SS"; a date-time prefix compares the same on
// Postgres).
async function listProjectsWithStuckExecutions(
  cutoff: string,
  limit: number,
): Promise<{ projectId: string; organizationId: string }[]> {
  return db
    .selectDistinct({
      projectId: changeLedgerEntries.projectId,
      organizationId: changeLedgerEntries.organizationId,
    })
    .from(changeLedgerEntries)
    .where(
      and(
        eq(changeLedgerEntries.status, "executing"),
        // Only Shopify changes have a store to reconcile against.
        eq(changeLedgerEntries.provider, "shopify"),
        lt(changeLedgerEntries.updatedAt, cutoff),
      ),
    )
    .orderBy(asc(changeLedgerEntries.projectId))
    .limit(limit);
}

export const ScheduledLedgerRepository = {
  listUnmeasuredEntries,
  listProjectsWithStuckExecutions,
};
