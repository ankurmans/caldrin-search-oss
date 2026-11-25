import type {
  AuditAction,
  AuditActorKind,
  AuditOutcome,
} from "@/shared/audit-log";
import {
  AuditLogRepository,
  type AuditFilter,
} from "../repositories/AuditLogRepository";
import { toCsv } from "../rules/auditCsv";

const SUMMARY_LIMIT = 300;
const RETENTION_DAYS = 400;
const PAGE_SIZE = 50;
const EXPORT_LIMIT = 10_000;

type AuditEntry = {
  organizationId: string;
  action: AuditAction;
  summary: string;
  actorKind?: AuditActorKind;
  actorUserId?: string | null;
  actorLabel?: string | null;
  actorClient?: string | null;
  projectId?: string | null;
  targetKind?: string | null;
  targetId?: string | null;
  outcome?: AuditOutcome;
};

/**
 * Appends one event. The action it describes has already happened (or been
 * refused), so a failure here is logged loudly and never changes the result.
 */
async function record(entry: AuditEntry) {
  try {
    await AuditLogRepository.insert({
      createdAt: new Date().toISOString(),
      organizationId: entry.organizationId,
      projectId: entry.projectId ?? null,
      actorKind: entry.actorKind ?? "user",
      actorUserId: entry.actorUserId ?? null,
      actorLabel: entry.actorLabel ?? null,
      actorClient: entry.actorClient ?? null,
      action: entry.action,
      targetKind: entry.targetKind ?? null,
      targetId: entry.targetId ?? null,
      summary: entry.summary.slice(0, SUMMARY_LIMIT),
      outcome: entry.outcome ?? "success",
    });
  } catch (error) {
    console.error("[audit] could not record", entry.action, error);
  }
}

type UserContext = {
  userId: string;
  userEmail: string;
  organizationId: string;
};

/** A signed-in person did it. The `extra` fields name the project and target. */
function recordUser(
  context: UserContext,
  action: AuditAction,
  summary: string,
  extra: Pick<AuditEntry, "projectId" | "targetKind" | "targetId"> = {},
) {
  return record({
    ...extra,
    organizationId: context.organizationId,
    action,
    summary,
    actorKind: "user",
    actorUserId: context.userId,
    actorLabel: context.userEmail,
  });
}

async function list(organizationId: string, filter: AuditFilter) {
  const rows = await AuditLogRepository.list(
    organizationId,
    filter,
    PAGE_SIZE + 1,
  );
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: page,
    next:
      rows.length > PAGE_SIZE && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

async function exportCsv(organizationId: string, filter: AuditFilter) {
  const rows = await AuditLogRepository.list(
    organizationId,
    { ...filter, before: undefined },
    EXPORT_LIMIT,
  );
  return {
    csv: toCsv(rows),
    rows: rows.length,
    truncated: rows.length === EXPORT_LIMIT,
  };
}

async function prune() {
  await AuditLogRepository.pruneBefore(
    new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString(),
  );
}

export const AuditLogService = { record, recordUser, list, exportCsv, prune };
