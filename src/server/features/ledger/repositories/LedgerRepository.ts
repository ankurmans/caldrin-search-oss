import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  changeLedgerEntries,
  changeLedgerEvidence,
  changeLedgerObservations,
  contentAssets,
  contentOpportunities,
  opportunityEvidence,
  providerCosts,
} from "@/db/schema";
import type {
  EvidenceInput,
  LedgerCostRow,
  LedgerEntry,
  LedgerEvidence,
  LedgerObservation,
  LedgerStatus,
  ListEntriesFilter,
} from "../types";

// Every query is scoped by projectId. Callers pass the projectId that
// requireProjectContext resolved from the session, never one from input.
// Child rows (evidence, observations) have no projectId; they are only read
// after the entry was fetched by (projectId, id).

const MAX_LIST = 200;

type NewEntry = typeof changeLedgerEntries.$inferInsert;
type EntryChanges = { [K in keyof NewEntry]?: NewEntry[K] | SQL };

const now = () => new Date().toISOString();

async function getEntry(
  projectId: string,
  entryId: string,
): Promise<LedgerEntry | null> {
  const rows = await db
    .select()
    .from(changeLedgerEntries)
    .where(
      and(
        eq(changeLedgerEntries.projectId, projectId),
        eq(changeLedgerEntries.id, entryId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function findByIdempotencyKey(
  projectId: string,
  key: string,
): Promise<LedgerEntry | null> {
  const rows = await db
    .select()
    .from(changeLedgerEntries)
    .where(
      and(
        eq(changeLedgerEntries.projectId, projectId),
        eq(changeLedgerEntries.idempotencyKey, key),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// The unique (projectId, idempotencyKey) index decides a double submit: one
// insert lands, the other reads the winner back.
async function insertProposal(
  entry: Omit<NewEntry, "id">,
  evidence: EvidenceInput[],
): Promise<{ entry: LedgerEntry; created: boolean }> {
  const [row] = await db
    .insert(changeLedgerEntries)
    .values({ id: crypto.randomUUID(), ...entry })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const existing = await findByIdempotencyKey(
      entry.projectId,
      entry.idempotencyKey ?? "",
    );
    if (!existing) throw new Error("Failed to create change_ledger_entry");
    return { entry: existing, created: false };
  }
  for (const item of evidence) {
    await db.insert(changeLedgerEvidence).values({
      id: crypto.randomUUID(),
      entryId: row.id,
      source: item.source,
      label: item.label,
      value: item.value,
      url: item.url ?? null,
      observedAt: item.observedAt ?? null,
    });
  }
  return { entry: row, created: true };
}

async function listEntries(
  projectId: string,
  filter: ListEntriesFilter,
): Promise<LedgerEntry[]> {
  const conditions: SQL[] = [eq(changeLedgerEntries.projectId, projectId)];
  if (filter.status)
    conditions.push(eq(changeLedgerEntries.status, filter.status));
  if (filter.kind) conditions.push(eq(changeLedgerEntries.kind, filter.kind));
  if (filter.provider)
    conditions.push(eq(changeLedgerEntries.provider, filter.provider));
  if (filter.opportunityId) {
    conditions.push(
      eq(changeLedgerEntries.opportunityId, filter.opportunityId),
    );
  }
  return db
    .select()
    .from(changeLedgerEntries)
    .where(and(...conditions))
    .orderBy(desc(changeLedgerEntries.createdAt), desc(changeLedgerEntries.id))
    .limit(Math.max(1, Math.min(MAX_LIST, filter.limit ?? 50)));
}

async function listEvidence(entryId: string): Promise<LedgerEvidence[]> {
  return db
    .select()
    .from(changeLedgerEvidence)
    .where(eq(changeLedgerEvidence.entryId, entryId))
    .orderBy(asc(changeLedgerEvidence.id));
}

async function listObservations(entryId: string): Promise<LedgerObservation[]> {
  return db
    .select()
    .from(changeLedgerObservations)
    .where(eq(changeLedgerObservations.entryId, entryId))
    .orderBy(
      asc(changeLedgerObservations.observedAt),
      asc(changeLedgerObservations.id),
    );
}

async function listCosts(
  projectId: string,
  entryId: string,
): Promise<{ totalUsd: number; rows: LedgerCostRow[] }> {
  const rows = await db
    .select()
    .from(providerCosts)
    .where(
      and(
        eq(providerCosts.projectId, projectId),
        eq(providerCosts.ledgerEntryId, entryId),
      ),
    )
    .orderBy(asc(providerCosts.createdAt), asc(providerCosts.id));
  return { totalUsd: rows.reduce((sum, r) => sum + r.costUsd, 0), rows };
}

// The opportunity's evidence, or null when the opportunity is not this
// project's (so a foreign id is indistinguishable from a missing one).
async function loadOpportunityEvidence(
  projectId: string,
  opportunityId: string,
): Promise<EvidenceInput[] | null> {
  const owned = await db
    .select({ id: contentOpportunities.id })
    .from(contentOpportunities)
    .where(
      and(
        eq(contentOpportunities.projectId, projectId),
        eq(contentOpportunities.id, opportunityId),
      ),
    )
    .limit(1);
  if (owned.length === 0) return null;
  const rows = await db
    .select()
    .from(opportunityEvidence)
    .where(eq(opportunityEvidence.opportunityId, opportunityId))
    .orderBy(asc(opportunityEvidence.id));
  return rows.map((r) => ({
    source: r.source,
    label: r.label,
    value: r.value,
    url: r.url,
    observedAt: r.observedAt,
  }));
}

async function getAssetRevision(
  projectId: string,
  assetId: string,
): Promise<number | null> {
  const rows = await db
    .select({ revision: contentAssets.revision })
    .from(contentAssets)
    .where(
      and(
        eq(contentAssets.projectId, projectId),
        eq(contentAssets.id, assetId),
      ),
    )
    .limit(1);
  return rows[0]?.revision ?? null;
}

// Literal table names on purpose: inside an UPDATE the entries table is the
// target, and content_assets has its own approved_revision column, so an
// unqualified name would silently bind to the wrong table.
function assetStillAt(projectId: string, column: string): SQL {
  return sql`(change_ledger_entries.content_asset_id IS NULL OR EXISTS (
    SELECT 1 FROM content_assets
    WHERE content_assets.id = change_ledger_entries.content_asset_id
      AND content_assets.project_id = ${projectId}
      AND content_assets.revision = ${sql.raw(`change_ledger_entries.${column}`)}
  ))`;
}

const REVISION_BOUND = sql`(
  (change_ledger_entries.approved_revision IS NULL AND change_ledger_entries.content_revision IS NULL)
  OR change_ledger_entries.approved_revision = change_ledger_entries.content_revision
)`;

// One conditional UPDATE decides every status move: of two concurrent callers
// only one sees its row come back from RETURNING.
async function transition(move: {
  projectId: string;
  entryId: string;
  from: LedgerStatus[];
  to: LedgerStatus;
  changes: EntryChanges;
  guards?: SQL[];
}): Promise<LedgerEntry | null> {
  const { projectId, entryId, from, to, changes, guards = [] } = move;
  const [row] = await db
    .update(changeLedgerEntries)
    .set({ ...changes, status: to, updatedAt: sql`(current_timestamp)` })
    .where(
      and(
        eq(changeLedgerEntries.projectId, projectId),
        eq(changeLedgerEntries.id, entryId),
        inArray(changeLedgerEntries.status, from),
        ...guards,
      ),
    )
    .returning();
  return row ?? null;
}

function approve(
  projectId: string,
  entryId: string,
  from: LedgerStatus[],
  userId: string,
): Promise<LedgerEntry | null> {
  // The approval records the revision the entry is about (copied in SQL, not
  // taken from a value read earlier), and the content must still be at it.
  return transition({
    projectId,
    entryId,
    from,
    to: "approved",
    changes: {
      approvedByUserId: userId,
      approvedAt: now(),
      approvedRevision: sql`change_ledger_entries.content_revision`,
      error: null,
    },
    guards: [assetStillAt(projectId, "content_revision")],
  });
}

// The approval-enforcement choke point: approved, with an approver on record,
// for the revision the entry is about, and the content still at it.
function beginExecution(
  projectId: string,
  entryId: string,
  from: LedgerStatus[],
  userId: string,
): Promise<LedgerEntry | null> {
  return transition({
    projectId,
    entryId,
    from,
    to: "executing",
    changes: { executedByUserId: userId },
    guards: [
      sql`change_ledger_entries.approved_by_user_id IS NOT NULL`,
      REVISION_BOUND,
      assetStillAt(projectId, "approved_revision"),
    ],
  });
}

async function setFinalDecision(
  projectId: string,
  entryId: string,
  statuses: LedgerStatus[],
  text: string,
  userId: string,
): Promise<LedgerEntry | null> {
  const [row] = await db
    .update(changeLedgerEntries)
    .set({
      finalDecision: text,
      finalDecidedByUserId: userId,
      finalDecidedAt: now(),
      updatedAt: sql`(current_timestamp)`,
    })
    .where(
      and(
        eq(changeLedgerEntries.projectId, projectId),
        eq(changeLedgerEntries.id, entryId),
        inArray(changeLedgerEntries.status, statuses),
      ),
    )
    .returning();
  return row ?? null;
}

async function setBaselineWindow(
  projectId: string,
  entryId: string,
  window: { start: string; end: string },
): Promise<void> {
  await db
    .update(changeLedgerEntries)
    .set({ baselineStart: window.start, baselineEnd: window.end })
    .where(
      and(
        eq(changeLedgerEntries.projectId, projectId),
        eq(changeLedgerEntries.id, entryId),
      ),
    );
}

async function hasObservation(
  entryId: string,
  probe: {
    phase: LedgerObservation["phase"];
    source: LedgerObservation["source"];
    metric: string;
    windowStart: string;
    windowEnd: string;
  },
): Promise<boolean> {
  const rows = await db
    .select({ id: changeLedgerObservations.id })
    .from(changeLedgerObservations)
    .where(
      and(
        eq(changeLedgerObservations.entryId, entryId),
        eq(changeLedgerObservations.phase, probe.phase),
        eq(changeLedgerObservations.source, probe.source),
        eq(changeLedgerObservations.metric, probe.metric),
        eq(changeLedgerObservations.windowStart, probe.windowStart),
        eq(changeLedgerObservations.windowEnd, probe.windowEnd),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function insertObservation(
  entryId: string,
  input: {
    phase: LedgerObservation["phase"];
    source: LedgerObservation["source"];
    metric: string;
    value: number;
    numerator?: number | null;
    denominator?: number | null;
    windowStart?: string | null;
    windowEnd?: string | null;
    aiRunId?: string | null;
    note?: string | null;
  },
): Promise<LedgerObservation> {
  const [row] = await db
    .insert(changeLedgerObservations)
    .values({
      id: crypto.randomUUID(),
      entryId,
      phase: input.phase,
      source: input.source,
      metric: input.metric,
      value: input.value,
      numerator: input.numerator ?? null,
      denominator: input.denominator ?? null,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
      observedAt: now(),
      aiRunId: input.aiRunId ?? null,
      note: input.note ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to create change_ledger_observation");
  return row;
}

export const LedgerRepository = {
  getEntry,
  insertProposal,
  listEntries,
  listEvidence,
  listObservations,
  listCosts,
  loadOpportunityEvidence,
  getAssetRevision,
  transition,
  approve,
  beginExecution,
  setFinalDecision,
  setBaselineWindow,
  hasObservation,
  insertObservation,
};
