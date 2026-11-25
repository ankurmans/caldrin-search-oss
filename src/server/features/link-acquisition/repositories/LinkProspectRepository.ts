import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  auditPages,
  audits,
  linkOutreachDrafts,
  linkPlacements,
  linkProspectEvents,
  linkProspectSignals,
  linkProspects,
} from "@/db/schema";
import type {
  LinkActor,
  LinkCampaignMode,
  LinkDiscoveryMethod,
  LinkProspectStatus,
  LinkRecommendation,
  LinkSignalKind,
} from "@/shared/link-acquisition";

const ID_CHUNK = 90;

export type LinkProspectRecord = typeof linkProspects.$inferSelect;

export type NewProspect = {
  dedupeKey: string;
  referringDomain: string;
  pageUrl: string | null;
  method: LinkDiscoveryMethod;
  campaignMode: LinkCampaignMode;
  status: LinkProspectStatus;
  recommendation: LinkRecommendation | null;
  score: number | null;
  targetUrl: string | null;
  sourceRunId: string | null;
  notes: string | null;
  signals: Array<{
    kind: LinkSignalKind;
    value: string;
    url?: string | null;
    source: string;
    observedAt: string;
  }>;
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** The keys that already exist for the project, so a save never duplicates. */
async function existingKeys(projectId: string, keys: string[]) {
  const rows = await Promise.all(
    chunk(keys, ID_CHUNK).map((part) =>
      db
        .select({ id: linkProspects.id, dedupeKey: linkProspects.dedupeKey })
        .from(linkProspects)
        .where(
          and(
            eq(linkProspects.projectId, projectId),
            inArray(linkProspects.dedupeKey, part),
          ),
        ),
    ),
  );
  return new Map(rows.flat().map((row) => [row.dedupeKey, row.id]));
}

/**
 * Inserts prospects that are new for the project and reports which already
 * existed. The unique (project, key) index is the final arbiter if two saves
 * race: the loser inserts nothing.
 */
async function insertNew(
  projectId: string,
  rows: NewProspect[],
  actor: LinkActor,
  userId: string,
) {
  const keys = new Map(rows.map((row) => [row.dedupeKey, row]));
  const existing = await existingKeys(projectId, [...keys.keys()]);
  const fresh = [...keys.values()].filter(
    (row) => !existing.has(row.dedupeKey),
  );
  const ids = new Map(fresh.map((row) => [row.dedupeKey, crypto.randomUUID()]));
  await runBatch((tx) =>
    fresh.flatMap((row) => {
      const id = ids.get(row.dedupeKey) ?? crypto.randomUUID();
      return [
        tx
          .insert(linkProspects)
          .values({
            id,
            projectId,
            dedupeKey: row.dedupeKey,
            referringDomain: row.referringDomain,
            pageUrl: row.pageUrl,
            method: row.method,
            campaignMode: row.campaignMode,
            status: row.status,
            recommendation: row.recommendation,
            score: row.score,
            targetUrl: row.targetUrl,
            sourceRunId: row.sourceRunId,
            notes: row.notes,
            createdBy: actor,
          })
          .onConflictDoNothing(),
        tx.insert(linkProspectEvents).values({
          id: crypto.randomUUID(),
          prospectId: id,
          fromStatus: null,
          toStatus: row.status,
          note: `Saved from ${row.method.replace(/_/g, " ")}`,
          actor,
          actorUserId: userId,
        }),
        ...row.signals.map((signal) =>
          tx.insert(linkProspectSignals).values({
            id: crypto.randomUUID(),
            prospectId: id,
            kind: signal.kind,
            value: signal.value,
            url: signal.url ?? null,
            source: signal.source,
            observedAt: signal.observedAt,
          }),
        ),
      ];
    }),
  );
  return {
    created: fresh.map((row) => ({
      id: ids.get(row.dedupeKey) ?? "",
      dedupeKey: row.dedupeKey,
    })),
    skipped: [...existing.keys()],
  };
}

type ProspectFilter = {
  status?: LinkProspectStatus;
  method?: LinkDiscoveryMethod;
  campaignMode?: LinkCampaignMode;
  assigneeUserId?: string;
  dueBefore?: string;
  search?: string;
  recommendation?: LinkRecommendation;
  sortBy: "updatedAt" | "score" | "dueDate" | "referringDomain";
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
};

async function list(projectId: string, filter: ProspectFilter) {
  const where: SQL[] = [eq(linkProspects.projectId, projectId)];
  if (filter.status) where.push(eq(linkProspects.status, filter.status));
  if (filter.method) where.push(eq(linkProspects.method, filter.method));
  if (filter.campaignMode)
    where.push(eq(linkProspects.campaignMode, filter.campaignMode));
  if (filter.recommendation)
    where.push(eq(linkProspects.recommendation, filter.recommendation));
  if (filter.assigneeUserId === "none")
    where.push(sql`${linkProspects.assigneeUserId} is null`);
  else if (filter.assigneeUserId)
    where.push(eq(linkProspects.assigneeUserId, filter.assigneeUserId));
  if (filter.dueBefore)
    where.push(
      sql`${linkProspects.dueDate} is not null and ${linkProspects.dueDate} <= ${filter.dueBefore}`,
    );
  if (filter.search)
    where.push(
      sql`lower(${linkProspects.referringDomain}) like ${`%${escapeLike(filter.search.toLowerCase())}%`} escape '\\'`,
    );
  const column = {
    updatedAt: linkProspects.updatedAt,
    score: linkProspects.score,
    dueDate: linkProspects.dueDate,
    referringDomain: linkProspects.referringDomain,
  }[filter.sortBy];
  const order = filter.sortDir === "asc" ? asc(column) : desc(column);
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(linkProspects)
      .where(and(...where))
      .orderBy(order, asc(linkProspects.id))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    db
      .select({ total: count() })
      .from(linkProspects)
      .where(and(...where)),
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}

async function getMany(projectId: string, ids: string[]) {
  const rows = await Promise.all(
    chunk(ids, ID_CHUNK).map((part) =>
      db
        .select()
        .from(linkProspects)
        .where(
          and(
            eq(linkProspects.projectId, projectId),
            inArray(linkProspects.id, part),
          ),
        ),
    ),
  );
  return rows.flat();
}

async function getOne(projectId: string, id: string) {
  return (await getMany(projectId, [id]))[0] ?? null;
}

async function eventsOf(prospectId: string) {
  return db
    .select()
    .from(linkProspectEvents)
    .where(eq(linkProspectEvents.prospectId, prospectId))
    .orderBy(desc(linkProspectEvents.createdAt));
}

async function signalsOf(prospectIds: string[]) {
  if (prospectIds.length === 0) return [];
  const rows = await Promise.all(
    chunk(prospectIds, ID_CHUNK).map((part) =>
      db
        .select()
        .from(linkProspectSignals)
        .where(inArray(linkProspectSignals.prospectId, part)),
    ),
  );
  return rows.flat();
}

type Patch = {
  status?: LinkProspectStatus;
  campaignMode?: LinkCampaignMode;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  targetUrl?: string | null;
  contentOpportunityId?: string | null;
  recommendation?: LinkRecommendation | null;
  score?: number | null;
};

/** One batch: the field changes plus a status event for every status move. */
async function applyPatch(input: {
  projectId: string;
  rows: LinkProspectRecord[];
  patch: Patch;
  note?: string | null;
  actor: LinkActor;
  userId: string;
}) {
  const { projectId, rows, patch } = input;
  if (rows.length === 0) return;
  const updatedAt = new Date().toISOString();
  await runBatch((tx) => [
    ...chunk(
      rows.map((row) => row.id),
      ID_CHUNK,
    ).map((ids) =>
      tx
        .update(linkProspects)
        .set({ ...patch, updatedAt })
        .where(
          and(
            eq(linkProspects.projectId, projectId),
            inArray(linkProspects.id, ids),
          ),
        ),
    ),
    ...rows
      .filter((row) => patch.status && patch.status !== row.status)
      .map((row) =>
        tx.insert(linkProspectEvents).values({
          id: crypto.randomUUID(),
          prospectId: row.id,
          fromStatus: row.status,
          toStatus: patch.status ?? row.status,
          note: input.note ?? null,
          actor: input.actor,
          actorUserId: input.userId,
        }),
      ),
  ]);
}

/** What has happened for a prospect, which decides the status moves allowed. */
async function facts(prospectIds: string[]) {
  const empty = new Map<
    string,
    {
      hasApprovedDraft: boolean;
      hasSentDraft: boolean;
      hasConfirmedPlacement: boolean;
    }
  >(
    prospectIds.map((id) => [
      id,
      {
        hasApprovedDraft: false,
        hasSentDraft: false,
        hasConfirmedPlacement: false,
      },
    ]),
  );
  if (prospectIds.length === 0) return empty;
  for (const part of chunk(prospectIds, ID_CHUNK)) {
    const drafts = await db
      .select({
        prospectId: linkOutreachDrafts.prospectId,
        status: linkOutreachDrafts.status,
      })
      .from(linkOutreachDrafts)
      .where(inArray(linkOutreachDrafts.prospectId, part));
    for (const draft of drafts) {
      const entry = empty.get(draft.prospectId);
      if (!entry) continue;
      if (
        draft.status === "approved" ||
        draft.status === "exported" ||
        draft.status === "sent"
      )
        entry.hasApprovedDraft = true;
      if (draft.status === "exported" || draft.status === "sent")
        entry.hasSentDraft = true;
    }
    const placements = await db
      .select({
        prospectId: linkPlacements.prospectId,
        state: linkPlacements.state,
      })
      .from(linkPlacements)
      .where(inArray(linkPlacements.prospectId, part));
    for (const placement of placements) {
      const entry = placement.prospectId
        ? empty.get(placement.prospectId)
        : undefined;
      if (entry && placement.state === "confirmed_live")
        entry.hasConfirmedPlacement = true;
    }
  }
  return empty;
}

/** Counts per status, for the Prospects header and reporting. */
async function statusCounts(projectId: string) {
  const rows = await db
    .select({ status: linkProspects.status, total: count() })
    .from(linkProspects)
    .where(eq(linkProspects.projectId, projectId))
    .groupBy(linkProspects.status);
  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}

/** The project's own indexable pages from its latest finished audit. */
async function ownPages(projectId: string, limit = 500) {
  const [latest] = await db
    .select({ id: audits.id })
    .from(audits)
    .where(and(eq(audits.projectId, projectId), eq(audits.status, "completed")))
    .orderBy(desc(audits.startedAt))
    .limit(1);
  if (!latest) return [];
  return db
    .select({ url: auditPages.url, title: auditPages.title })
    .from(auditPages)
    .where(
      and(
        eq(auditPages.auditId, latest.id),
        eq(auditPages.statusCode, 200),
        eq(auditPages.isIndexable, true),
      ),
    )
    .limit(limit);
}

export const LinkProspectRepository = {
  insertNew,
  list,
  getMany,
  getOne,
  eventsOf,
  signalsOf,
  applyPatch,
  facts,
  statusCounts,
  ownPages,
};
