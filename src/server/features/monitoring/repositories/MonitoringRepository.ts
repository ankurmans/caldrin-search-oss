import { and, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alertDestinations,
  aiPromptSetVersions,
  aiRuns,
  aiTrackers,
  member,
  monitoringJobRuns,
  projectAlerts,
  projects,
  user,
} from "@/db/schema";

export type NewAlert = Omit<
  typeof projectAlerts.$inferInsert,
  "id" | "readAt" | "emailedAt"
>;
type JobStatus = (typeof monitoringJobRuns.$inferSelect)["status"];

/** Live projects with an AI tracker, oldest first so a capped pass is stable. */
async function listTrackedProjects(limit: number) {
  return db
    .select({
      projectId: projects.id,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .innerJoin(aiTrackers, eq(aiTrackers.projectId, projects.id))
    .where(isNull(projects.archivedAt))
    .orderBy(projects.id)
    .limit(limit);
}

/**
 * UTC days (YYYY-MM-DD) with at least one finished run created before
 * `before`, newest first. ISO timestamps make the first ten characters the day
 * on both dialects.
 */
async function listCollectionDays(
  projectId: string,
  before: string,
  limit: number,
) {
  const day = sql<string>`substr(${aiRuns.createdAt}, 1, 10)`;
  const rows = await db
    .selectDistinct({ day })
    .from(aiRuns)
    .where(
      and(
        eq(aiRuns.projectId, projectId),
        inArray(aiRuns.status, ["completed", "partial"]),
        lt(aiRuns.createdAt, before),
      ),
    )
    .orderBy(desc(day))
    .limit(limit);
  return rows.map((row) => String(row.day));
}

/** The prompt-set version number, scoped through the project's tracker. */
async function getPromptSetVersionNumber(projectId: string, versionId: string) {
  const [row] = await db
    .select({ version: aiPromptSetVersions.version })
    .from(aiPromptSetVersions)
    .innerJoin(aiTrackers, eq(aiTrackers.id, aiPromptSetVersions.trackerId))
    .where(
      and(
        eq(aiPromptSetVersions.id, versionId),
        eq(aiTrackers.projectId, projectId),
      ),
    )
    .limit(1);
  return row?.version ?? null;
}

async function getJobRun(idempotencyKey: string) {
  const [row] = await db
    .select()
    .from(monitoringJobRuns)
    .where(eq(monitoringJobRuns.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ?? null;
}

/** One row per key: the first attempt inserts it, a retry updates it. */
async function saveJobRun(input: {
  projectId: string;
  job: string;
  idempotencyKey: string;
  status: JobStatus;
  reason: string | null;
  attempt: number;
  startedAt: string;
  finishedAt: string;
}) {
  await db
    .insert(monitoringJobRuns)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoUpdate({
      target: monitoringJobRuns.idempotencyKey,
      set: {
        status: input.status,
        reason: input.reason,
        attempt: input.attempt,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
      },
    });
}

/** Inserts the alert unless one with the same dedupe key exists; returns the new id or null. */
async function insertAlert(alert: NewAlert): Promise<string | null> {
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(projectAlerts)
    .values({ id, ...alert })
    .onConflictDoNothing({
      target: [projectAlerts.projectId, projectAlerts.dedupeKey],
    })
    .returning({ id: projectAlerts.id });
  return inserted[0]?.id ?? null;
}

async function listAlerts(
  projectId: string,
  page: { limit: number; offset: number },
) {
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(projectAlerts)
      .where(eq(projectAlerts.projectId, projectId))
      .orderBy(desc(projectAlerts.createdAt), desc(projectAlerts.id))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({
        total: count(),
        unread: sql<number>`sum(case when ${projectAlerts.readAt} is null then 1 else 0 end)`,
      })
      .from(projectAlerts)
      .where(eq(projectAlerts.projectId, projectId)),
  ]);
  return {
    rows,
    total: Number(totals?.total ?? 0),
    unread: Number(totals?.unread ?? 0),
  };
}

/** Marks the given alerts (or every unread one) read, in this project only. */
async function markRead(projectId: string, alertIds: string[] | "all") {
  await db
    .update(projectAlerts)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(projectAlerts.projectId, projectId),
        isNull(projectAlerts.readAt),
        alertIds === "all" ? undefined : inArray(projectAlerts.id, alertIds),
      ),
    );
}

async function getAlerts(projectId: string, alertIds: string[]) {
  if (!alertIds.length) return [];
  return db
    .select()
    .from(projectAlerts)
    .where(
      and(
        eq(projectAlerts.projectId, projectId),
        inArray(projectAlerts.id, alertIds),
      ),
    );
}

async function markEmailed(projectId: string, alertId: string, at: string) {
  await db
    .update(projectAlerts)
    .set({ emailedAt: at })
    .where(
      and(
        eq(projectAlerts.projectId, projectId),
        eq(projectAlerts.id, alertId),
      ),
    );
}

/** Email addresses of the organization's owners. */
async function listOwnerEmails(organizationId: string) {
  const rows = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(eq(member.organizationId, organizationId), eq(member.role, "owner")),
    );
  return rows.map((row) => row.email);
}

async function getDestinations(organizationId: string) {
  return (
    (
      await db
        .select()
        .from(alertDestinations)
        .where(eq(alertDestinations.organizationId, organizationId))
        .limit(1)
    )[0] ?? null
  );
}

async function saveDestinations(
  organizationId: string,
  values: { emailEnabled: boolean; slackWebhookSealed: string | null },
) {
  const row = { ...values, updatedAt: new Date().toISOString() };
  await db
    .insert(alertDestinations)
    .values({ organizationId, ...row })
    .onConflictDoUpdate({ target: alertDestinations.organizationId, set: row });
}

export const MonitoringRepository = {
  getDestinations,
  saveDestinations,
  listTrackedProjects,
  listCollectionDays,
  getPromptSetVersionNumber,
  getJobRun,
  saveJobRun,
  insertAlert,
  listAlerts,
  markRead,
  getAlerts,
  markEmailed,
  listOwnerEmails,
};
