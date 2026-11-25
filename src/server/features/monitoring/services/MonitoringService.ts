import { MonitoringRepository as repo } from "../repositories/MonitoringRepository";
import { alertDetailsSchema } from "../types";

/** Stored text: a row that no longer parses still shows its title and body. */
function parseDetails(text: string) {
  try {
    const parsed = alertDetailsSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// In-app alerts. Every call is scoped by the projectId requireProjectContext
// resolved from the session, never one taken from input.

async function listAlerts(
  projectId: string,
  page: { limit: number; offset: number },
) {
  const { rows, total, unread } = await repo.listAlerts(projectId, page);
  return {
    total,
    unread,
    alerts: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      comparable: row.comparable,
      conditions: parseDetails(row.detailsJson)?.conditions ?? null,
      createdAt: row.createdAt,
      readAt: row.readAt,
      emailedAt: row.emailedAt,
    })),
  };
}

async function markRead(projectId: string, alertIds: string[] | "all") {
  await repo.markRead(projectId, alertIds);
}

export const MonitoringService = { listAlerts, markRead };
