import type { DatabaseSync } from "node:sqlite";

// Rows for the scheduled-job and GA4 tests, written straight into the migrated
// test database so the real queries decide what is due.

export const NOW = new Date("2026-11-16T10:00:00.000Z");
export const DUE_EXECUTED_AT = "2026-10-01T12:00:00.000Z";

type EntryRow = {
  id: string;
  projectId?: string;
  status?: string;
  provider?: string;
  publicationStatus?: string;
  executedAt?: string | null;
  measurementWindowDays?: number | null;
  targetUrl?: string | null;
  updatedAt?: string;
};

export function seedEntry(database: DatabaseSync, row: EntryRow) {
  const projectId = row.projectId ?? "project-a";
  database
    .prepare(
      `INSERT INTO change_ledger_entries (id, project_id, organization_id, kind, provider, status, publication_status, target_url, proposed_action, requested_by_user_id, executed_at, measurement_window_days, updated_at)
       VALUES (?, ?, ?, 'metadata_update', ?, ?, ?, ?, 'Update title', 'user-1', ?, ?, ?)`,
    )
    .run(
      row.id,
      projectId,
      `org-of-${projectId}`,
      row.provider ?? "shopify",
      row.status ?? "executed",
      row.publicationStatus ?? "published",
      row.targetUrl === undefined
        ? `https://shop.example/blogs/news/${row.id}`
        : row.targetUrl,
      row.executedAt === undefined ? DUE_EXECUTED_AT : row.executedAt,
      row.measurementWindowDays === undefined ? 28 : row.measurementWindowDays,
      row.updatedAt ?? "2026-10-01 12:00:00",
    );
}

export function seedGa4Connection(database: DatabaseSync, projectId: string) {
  database
    .prepare(
      `INSERT INTO ga4_connections (id, project_id, organization_id, property_id, property_display_name, property_time_zone, property_currency_code, connected_by_user_id, ga4_account_id)
       VALUES (?, ?, ?, 'properties/123', 'Shop', 'UTC', 'USD', 'user-1', 'account-1')`,
    )
    .run(`ga4-${projectId}`, projectId, `org-of-${projectId}`);
}

export function rows(
  database: DatabaseSync,
  query: string,
): Record<string, unknown>[] {
  return database
    .prepare(query)
    .all()
    .map((row) => ({ ...row }));
}
