import { and, asc, desc, eq, inArray, ne, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditIssues,
  audits,
  changeLedgerEntries,
  contentAssets,
  contentOpportunities,
  opportunityEvidence,
  projects,
} from "@/db/schema";
import { NOT_FOUND_EVIDENCE } from "../rules/reconcileRules";
import type {
  AuditIssueRow,
  EvidenceInput,
  OpportunityCandidate,
} from "../types";

// Every query is scoped by projectId, which callers take from
// requireProjectContext, never from input.

export type StoredOpportunity = typeof contentOpportunities.$inferSelect;
type StoredEvidence = typeof opportunityEvidence.$inferSelect;

export type OpportunityFilters = {
  intent?: NonNullable<StoredOpportunity["intent"]>;
  action?: StoredOpportunity["recommendedAction"];
  status?: StoredOpportunity["status"];
  source?: StoredOpportunity["dataSource"];
};

// D1 allows about 100 bound parameters per statement; evidence rows bind 7.
const EVIDENCE_CHUNK = 10;
const RECONCILE_CHUNK = 50;

async function replaceEvidence(
  opportunityId: string,
  evidence: EvidenceInput[],
): Promise<void> {
  await db
    .delete(opportunityEvidence)
    .where(eq(opportunityEvidence.opportunityId, opportunityId));
  for (let i = 0; i < evidence.length; i += EVIDENCE_CHUNK) {
    await db.insert(opportunityEvidence).values(
      evidence.slice(i, i + EVIDENCE_CHUNK).map((e) => ({
        id: crypto.randomUUID(),
        opportunityId,
        source: e.source,
        label: e.label,
        value: e.value,
        url: e.url ?? null,
        observedAt: e.observedAt ?? null,
      })),
    );
  }
}

// Insert or update by (projectId, dedupeKey). The status is left alone on an
// update, so a dismissed or briefed opportunity stays that way on a re-run.
// Evidence is replaced with what this run observed.
async function upsertCandidate(
  scope: { projectId: string; organizationId: string },
  candidate: OpportunityCandidate,
): Promise<string> {
  const fields = {
    query: candidate.query,
    pageUrl: candidate.pageUrl,
    impressions: candidate.impressions,
    clicks: candidate.clicks,
    ctr: candidate.ctr,
    position: candidate.position,
    windowStart: candidate.windowStart,
    windowEnd: candidate.windowEnd,
    recommendedAction: candidate.action,
    reason: candidate.reason,
    matchedCollectionHandle: candidate.matchedCollectionHandle,
    dataSource: candidate.dataSource,
    intent: candidate.intent,
    priority: candidate.priority,
    priorityReason: candidate.priorityReason,
    observedAt: candidate.observedAt,
  };
  const [row] = await db
    .insert(contentOpportunities)
    .values({
      id: crypto.randomUUID(),
      projectId: scope.projectId,
      organizationId: scope.organizationId,
      dedupeKey: candidate.dedupeKey,
      ...fields,
    })
    .onConflictDoUpdate({
      target: [contentOpportunities.projectId, contentOpportunities.dedupeKey],
      set: { ...fields, updatedAt: sql`(current_timestamp)` },
    })
    .returning({ id: contentOpportunities.id });
  if (!row) throw new Error("Failed to upsert content_opportunity");
  await replaceEvidence(row.id, candidate.evidence);
  return row.id;
}

const priorityOrder = sql`case ${contentOpportunities.priority} when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end`;

async function listOpportunities(
  projectId: string,
  filters: OpportunityFilters = {},
): Promise<StoredOpportunity[]> {
  return db
    .select()
    .from(contentOpportunities)
    .where(
      and(
        eq(contentOpportunities.projectId, projectId),
        filters.intent
          ? eq(contentOpportunities.intent, filters.intent)
          : undefined,
        filters.action
          ? eq(contentOpportunities.recommendedAction, filters.action)
          : undefined,
        filters.status
          ? eq(contentOpportunities.status, filters.status)
          : undefined,
        filters.source
          ? eq(contentOpportunities.dataSource, filters.source)
          : undefined,
      ),
    )
    .orderBy(
      priorityOrder,
      desc(contentOpportunities.impressions),
      asc(contentOpportunities.id),
    );
}

async function getOpportunityDetail(
  projectId: string,
  id: string,
): Promise<{
  opportunity: StoredOpportunity;
  evidence: StoredEvidence[];
} | null> {
  const [opportunity] = await db
    .select()
    .from(contentOpportunities)
    .where(
      and(
        eq(contentOpportunities.projectId, projectId),
        eq(contentOpportunities.id, id),
      ),
    )
    .limit(1);
  if (!opportunity) return null;
  const evidence = await db
    .select()
    .from(opportunityEvidence)
    .where(eq(opportunityEvidence.opportunityId, opportunity.id))
    .orderBy(asc(opportunityEvidence.id));
  return { opportunity, evidence };
}

async function setStatus(
  projectId: string,
  id: string,
  status: "open" | "briefed" | "dismissed",
): Promise<boolean> {
  const rows = await db
    .update(contentOpportunities)
    .set({ status, updatedAt: sql`(current_timestamp)` })
    .where(
      and(
        eq(contentOpportunities.projectId, projectId),
        eq(contentOpportunities.id, id),
      ),
    )
    .returning({ id: contentOpportunities.id });
  return rows.length === 1;
}

// Removes the rows a run did not re-produce, but only rows with no history: an
// open opportunity nobody drafted for, briefed, dismissed or logged a change
// against. The guard is repeated inside the DELETE so a draft created while the
// run is in flight still protects its row. D1 has no interactive transaction,
// so evidence goes first and the opportunity second; a failure in between
// leaves a row that the next run removes. Rows with history stay.
async function reconcileStale(
  projectId: string,
  input: {
    producedKeys: ReadonlySet<string>;
    isCovered: (dedupeKey: string) => boolean;
    observedAt: string;
  },
): Promise<{ removed: number; keptStale: number }> {
  const rows = await db
    .select({
      id: contentOpportunities.id,
      dedupeKey: contentOpportunities.dedupeKey,
    })
    .from(contentOpportunities)
    .where(eq(contentOpportunities.projectId, projectId));
  const staleIds = rows
    .filter(
      (r) =>
        !r.dedupeKey.startsWith("claim-correction:") &&
        !input.producedKeys.has(r.dedupeKey) &&
        input.isCovered(r.dedupeKey),
    )
    .map((r) => r.id);
  const noHistory = and(
    eq(contentOpportunities.projectId, projectId),
    eq(contentOpportunities.status, "open"),
    notExists(
      db
        .select({ one: sql`1` })
        .from(contentAssets)
        .where(eq(contentAssets.opportunityId, contentOpportunities.id)),
    ),
    notExists(
      db
        .select({ one: sql`1` })
        .from(changeLedgerEntries)
        .where(eq(changeLedgerEntries.opportunityId, contentOpportunities.id)),
    ),
  );
  let removed = 0;
  for (let i = 0; i < staleIds.length; i += RECONCILE_CHUNK) {
    const chunk = staleIds.slice(i, i + RECONCILE_CHUNK);
    const deletable = await db
      .select({ id: contentOpportunities.id })
      .from(contentOpportunities)
      .where(and(inArray(contentOpportunities.id, chunk), noHistory));
    const ids = deletable.map((r) => r.id);
    if (ids.length === 0) continue;
    await db
      .delete(opportunityEvidence)
      .where(inArray(opportunityEvidence.opportunityId, ids));
    const gone = await db
      .delete(contentOpportunities)
      .where(and(inArray(contentOpportunities.id, ids), noHistory))
      .returning({ id: contentOpportunities.id });
    removed += gone.length;
  }
  const kept = await markNotFound(staleIds, input.observedAt);
  return { removed, keptStale: kept };
}

// Gives every kept row a fresh marker evidence row; returns how many exist.
async function markNotFound(
  ids: string[],
  observedAt: string,
): Promise<number> {
  let kept = 0;
  for (let i = 0; i < ids.length; i += RECONCILE_CHUNK) {
    const chunk = ids.slice(i, i + RECONCILE_CHUNK);
    const alive = (
      await db
        .select({ id: contentOpportunities.id })
        .from(contentOpportunities)
        .where(inArray(contentOpportunities.id, chunk))
    ).map((r) => r.id);
    if (alive.length === 0) continue;
    await db
      .delete(opportunityEvidence)
      .where(
        and(
          inArray(opportunityEvidence.opportunityId, alive),
          eq(opportunityEvidence.source, NOT_FOUND_EVIDENCE.source),
          eq(opportunityEvidence.label, NOT_FOUND_EVIDENCE.label),
        ),
      );
    for (let j = 0; j < alive.length; j += EVIDENCE_CHUNK) {
      await db.insert(opportunityEvidence).values(
        alive.slice(j, j + EVIDENCE_CHUNK).map((opportunityId) => ({
          id: crypto.randomUUID(),
          opportunityId,
          source: NOT_FOUND_EVIDENCE.source,
          label: NOT_FOUND_EVIDENCE.label,
          value: "The analysis ran and did not produce this opportunity again.",
          url: null,
          observedAt,
        })),
      );
    }
    kept += alive.length;
  }
  return kept;
}

// Ids of the project's rows that carry the "not found" marker.
async function listNotFoundIds(projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: opportunityEvidence.opportunityId })
    .from(opportunityEvidence)
    .innerJoin(
      contentOpportunities,
      eq(contentOpportunities.id, opportunityEvidence.opportunityId),
    )
    .where(
      and(
        eq(contentOpportunities.projectId, projectId),
        eq(opportunityEvidence.source, NOT_FOUND_EVIDENCE.source),
        eq(opportunityEvidence.label, NOT_FOUND_EVIDENCE.label),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

// Evidence for several opportunities at once, for list views that show counts.
async function countEvidence(
  projectId: string,
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      opportunityId: opportunityEvidence.opportunityId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(opportunityEvidence)
    .innerJoin(
      contentOpportunities,
      eq(contentOpportunities.id, opportunityEvidence.opportunityId),
    )
    .where(
      and(
        eq(contentOpportunities.projectId, projectId),
        inArray(opportunityEvidence.opportunityId, ids),
        // The "not found" marker is a note about the row, not data behind it.
        ne(opportunityEvidence.source, NOT_FOUND_EVIDENCE.source),
      ),
    )
    .groupBy(opportunityEvidence.opportunityId);
  return new Map(rows.map((r) => [r.opportunityId, r.count]));
}

// The newest completed audit of the project and its stored issue rows.
async function latestAuditIssues(projectId: string): Promise<{
  auditId: string;
  observedAt: string;
  issues: AuditIssueRow[];
} | null> {
  const [audit] = await db
    .select({
      id: audits.id,
      completedAt: audits.completedAt,
      startedAt: audits.startedAt,
    })
    .from(audits)
    .where(and(eq(audits.projectId, projectId), eq(audits.status, "completed")))
    .orderBy(desc(audits.startedAt))
    .limit(1);
  if (!audit) return null;
  const issues = await db
    .select({
      issueType: auditIssues.issueType,
      severity: auditIssues.severity,
      pageUrl: auditIssues.pageUrl,
    })
    .from(auditIssues)
    .where(eq(auditIssues.auditId, audit.id))
    .limit(20_000);
  return {
    auditId: audit.id,
    observedAt: audit.completedAt ?? audit.startedAt,
    issues,
  };
}

async function getProjectBrand(projectId: string): Promise<{
  name: string;
  brandName: string | null;
  domain: string | null;
  locationCode: number;
  languageCode: string;
} | null> {
  const [row] = await db
    .select({
      name: projects.name,
      brandName: projects.brandName,
      domain: projects.domain,
      locationCode: projects.locationCode,
      languageCode: projects.languageCode,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}

export const OpportunityRepository = {
  getProjectBrand,
  upsertCandidate,
  listOpportunities,
  getOpportunityDetail,
  setStatus,
  countEvidence,
  reconcileStale,
  listNotFoundIds,
  latestAuditIssues,
};
