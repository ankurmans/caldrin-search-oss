import { and, desc, eq, gte, like, lt, lte, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";

export type AuditRow = typeof auditEvents.$inferSelect;
type NewAuditLogRow = Omit<typeof auditEvents.$inferInsert, "id">;

export type AuditFilter = {
  /** An exact action, or a group prefix such as "links." */
  action?: string;
  actorKind?: AuditRow["actorKind"];
  projectId?: string;
  from?: string;
  to?: string;
  /** Rows strictly older than this (createdAt, id) pair. */
  before?: { createdAt: string; id: string };
};

async function insert(row: NewAuditLogRow) {
  await db.insert(auditEvents).values({ id: crypto.randomUUID(), ...row });
}

function conditions(organizationId: string, filter: AuditFilter) {
  const parts: SQL[] = [eq(auditEvents.organizationId, organizationId)];
  if (filter.action) {
    parts.push(
      filter.action.endsWith(".")
        ? like(auditEvents.action, `${filter.action}%`)
        : eq(auditEvents.action, filter.action),
    );
  }
  if (filter.actorKind) parts.push(eq(auditEvents.actorKind, filter.actorKind));
  if (filter.projectId) parts.push(eq(auditEvents.projectId, filter.projectId));
  if (filter.from) parts.push(gte(auditEvents.createdAt, filter.from));
  if (filter.to) parts.push(lte(auditEvents.createdAt, filter.to));
  if (filter.before) {
    const older = or(
      lt(auditEvents.createdAt, filter.before.createdAt),
      and(
        eq(auditEvents.createdAt, filter.before.createdAt),
        lt(auditEvents.id, filter.before.id),
      ),
    );
    if (older) parts.push(older);
  }
  return and(...parts);
}

async function list(
  organizationId: string,
  filter: AuditFilter,
  limit: number,
) {
  return db
    .select()
    .from(auditEvents)
    .where(conditions(organizationId, filter))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit);
}

async function pruneBefore(cutoff: string) {
  await db.delete(auditEvents).where(lt(auditEvents.createdAt, cutoff));
}

export const AuditLogRepository = { insert, list, pruneBefore };
