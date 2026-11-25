import { and, count, desc, eq, gte, inArray, or } from "drizzle-orm";
import { chunk } from "remeda";
import type { LinkActor } from "@/shared/link-acquisition";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  linkOutreachDraftEvidence,
  linkOutreachDrafts,
  linkOutreachEvents,
  linkOutreachSuppressions,
  linkProspects,
} from "@/db/schema";

type DraftRecord = typeof linkOutreachDrafts.$inferSelect;
type SuppressionReason =
  (typeof linkOutreachSuppressions.$inferSelect)["reason"];
type EventKind = (typeof linkOutreachEvents.$inferInsert)["kind"];
type DraftStatus = DraftRecord["status"];

const ID_CHUNK = 90;

async function insertDraft(input: {
  projectId: string;
  prospectId: string;
  subject: string;
  body: string;
  contactName: string | null;
  contactEmail: string | null;
  evidenceIds: string[];
  actor: LinkActor;
}) {
  const id = crypto.randomUUID();
  await runBatch((tx) => [
    tx.insert(linkOutreachDrafts).values({
      id,
      projectId: input.projectId,
      prospectId: input.prospectId,
      subject: input.subject,
      body: input.body,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      createdBy: input.actor,
    }),
    ...chunk(input.evidenceIds, 40).map((ids) =>
      tx
        .insert(linkOutreachDraftEvidence)
        .values(ids.map((evidenceId) => ({ draftId: id, evidenceId }))),
    ),
  ]);
  return id;
}

async function getDraft(projectId: string, id: string) {
  const [row] = await db
    .select()
    .from(linkOutreachDrafts)
    .where(
      and(
        eq(linkOutreachDrafts.projectId, projectId),
        eq(linkOutreachDrafts.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function listDrafts(projectId: string, prospectId?: string) {
  return db
    .select()
    .from(linkOutreachDrafts)
    .where(
      and(
        eq(linkOutreachDrafts.projectId, projectId),
        prospectId ? eq(linkOutreachDrafts.prospectId, prospectId) : undefined,
      ),
    )
    .orderBy(desc(linkOutreachDrafts.createdAt))
    .limit(200);
}

async function eventsOf(draftIds: string[]) {
  if (draftIds.length === 0) return [];
  const rows = await Promise.all(
    chunk(draftIds, ID_CHUNK).map((part) =>
      db
        .select()
        .from(linkOutreachEvents)
        .where(inArray(linkOutreachEvents.draftId, part))
        .orderBy(desc(linkOutreachEvents.createdAt)),
    ),
  );
  return rows.flat();
}

async function evidenceIdsOf(draftId: string) {
  const rows = await db
    .select({ evidenceId: linkOutreachDraftEvidence.evidenceId })
    .from(linkOutreachDraftEvidence)
    .where(eq(linkOutreachDraftEvidence.draftId, draftId));
  return rows.map((row) => row.evidenceId);
}

/** A draft that is already approved, exported or sent for this domain or address. */
async function activeContactFor(
  projectId: string,
  referringDomain: string,
  contactEmail: string | null,
  exceptDraftId: string,
) {
  const rows = await db
    .select({
      id: linkOutreachDrafts.id,
      contactEmail: linkOutreachDrafts.contactEmail,
      status: linkOutreachDrafts.status,
      domain: linkProspects.referringDomain,
    })
    .from(linkOutreachDrafts)
    .innerJoin(
      linkProspects,
      eq(linkProspects.id, linkOutreachDrafts.prospectId),
    )
    .where(
      and(
        eq(linkOutreachDrafts.projectId, projectId),
        inArray(linkOutreachDrafts.status, ["approved", "exported", "sent"]),
        or(
          eq(linkProspects.referringDomain, referringDomain),
          contactEmail
            ? eq(linkOutreachDrafts.contactEmail, contactEmail)
            : undefined,
        ),
      ),
    );
  return rows.find((row) => row.id !== exceptDraftId) ?? null;
}

async function draftsToday(projectId: string, since: string) {
  const [row] = await db
    .select({ total: count() })
    .from(linkOutreachDrafts)
    .where(
      and(
        eq(linkOutreachDrafts.projectId, projectId),
        gte(linkOutreachDrafts.createdAt, since),
      ),
    );
  return row?.total ?? 0;
}

async function updateDraft(
  projectId: string,
  id: string,
  patch: Partial<
    Pick<
      DraftRecord,
      | "subject"
      | "body"
      | "contactName"
      | "contactEmail"
      | "status"
      | "editedByUser"
      | "approvedBy"
      | "approvedAt"
    >
  >,
  event?: {
    kind: EventKind;
    note?: string | null;
    actor: LinkActor;
    userId: string;
  },
) {
  await runBatch((tx) => [
    tx
      .update(linkOutreachDrafts)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(linkOutreachDrafts.projectId, projectId),
          eq(linkOutreachDrafts.id, id),
        ),
      ),
    ...(event
      ? [
          tx.insert(linkOutreachEvents).values({
            id: crypto.randomUUID(),
            draftId: id,
            kind: event.kind,
            note: event.note ?? null,
            actor: event.actor,
            actorUserId: event.userId,
          }),
        ]
      : []),
  ]);
}

async function logEvent(
  draftId: string,
  event: {
    kind: EventKind;
    note?: string | null;
    actor: LinkActor;
    userId: string;
  },
) {
  await db.insert(linkOutreachEvents).values({
    id: crypto.randomUUID(),
    draftId,
    kind: event.kind,
    note: event.note ?? null,
    actor: event.actor,
    actorUserId: event.userId,
  });
}

async function suppressed(projectId: string, values: string[]) {
  const wanted = values.filter(Boolean).map((value) => value.toLowerCase());
  if (wanted.length === 0) return null;
  const [row] = await db
    .select()
    .from(linkOutreachSuppressions)
    .where(
      and(
        eq(linkOutreachSuppressions.projectId, projectId),
        inArray(linkOutreachSuppressions.value, wanted),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function addSuppression(
  projectId: string,
  value: string,
  reason: SuppressionReason,
) {
  await db
    .insert(linkOutreachSuppressions)
    .values({ projectId, value: value.toLowerCase(), reason })
    .onConflictDoNothing();
}

async function listSuppressions(projectId: string) {
  return db
    .select()
    .from(linkOutreachSuppressions)
    .where(eq(linkOutreachSuppressions.projectId, projectId))
    .orderBy(desc(linkOutreachSuppressions.createdAt));
}

async function removeSuppression(projectId: string, value: string) {
  await db
    .delete(linkOutreachSuppressions)
    .where(
      and(
        eq(linkOutreachSuppressions.projectId, projectId),
        eq(linkOutreachSuppressions.value, value.toLowerCase()),
      ),
    );
}

/** Draft counts per status, for reporting. */
async function statusCounts(projectId: string) {
  const rows = await db
    .select({ status: linkOutreachDrafts.status, total: count() })
    .from(linkOutreachDrafts)
    .where(eq(linkOutreachDrafts.projectId, projectId))
    .groupBy(linkOutreachDrafts.status);
  return Object.fromEntries(
    rows.map((row) => [row.status, row.total]),
  ) as Partial<Record<DraftStatus, number>>;
}

async function replyCount(projectId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(linkOutreachEvents)
    .innerJoin(
      linkOutreachDrafts,
      eq(linkOutreachDrafts.id, linkOutreachEvents.draftId),
    )
    .where(
      and(
        eq(linkOutreachDrafts.projectId, projectId),
        eq(linkOutreachEvents.kind, "reply_logged"),
      ),
    );
  return row?.total ?? 0;
}

export const LinkOutreachRepository = {
  insertDraft,
  getDraft,
  listDrafts,
  eventsOf,
  evidenceIdsOf,
  activeContactFor,
  draftsToday,
  updateDraft,
  logEvent,
  suppressed,
  addSuppression,
  listSuppressions,
  removeSuppression,
  statusCounts,
  replyCount,
};
