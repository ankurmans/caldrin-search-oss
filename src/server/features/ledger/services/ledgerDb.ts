import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { LedgerScope } from "../types";

// Real SQL for the ledger tests: an in-memory SQLite built from the shipped
// migrations, behind the same drizzle proxy the repositories use.

const holder: { database: DatabaseSync | null } = { database: null };

export const scopeA: LedgerScope = {
  projectId: "project-a",
  organizationId: "org-1",
  userId: "user-1",
};
export const scopeB: LedgerScope = { ...scopeA, projectId: "project-b" };

export function ledgerDbMock() {
  return {
    db: drizzle(async (query, params, method) => {
      if (!holder.database) throw new Error("Database not initialized");
      const statement = holder.database.prepare(query);
      const values = params.map((value: unknown): SQLInputValue => {
        if (
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "bigint"
        )
          return value;
        throw new Error("Unexpected SQL parameter");
      });
      if (method === "run") {
        statement.run(...values);
        return { rows: [] };
      }
      return {
        rows: statement.all(...values).map((row) => Object.values(row)),
      };
    }),
  };
}

function apply(database: DatabaseSync, file: string, only?: RegExp) {
  for (const chunk of readFileSync(file, "utf8").split(
    "--> statement-breakpoint",
  )) {
    if (!only || only.test(chunk)) database.exec(chunk);
  }
}

export function resetDatabase() {
  holder.database?.close();
  const database = new DatabaseSync(":memory:");
  // Ownership is enforced by projectId scoping, which is what these test.
  database.exec("PRAGMA foreign_keys = OFF");
  apply(database, "drizzle/sqlite/0075_flat_war_machine.sql");
  apply(database, "drizzle/sqlite/0078_typical_zodiak.sql");
  apply(
    database,
    "drizzle/sqlite/0079_outgoing_bushwacker.sql",
    /change_ledger|opportunity_evidence|provider_costs|content_opportunities/,
  );
  // Only the columns the name lookup reads; the real tables come from the
  // auth migrations, which the ledger tests do not otherwise need.
  database.exec(
    `CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
     CREATE TABLE member (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at INTEGER NOT NULL DEFAULT 0);`,
  );
  holder.database = database;
}

export function seedMember(
  organizationId: string,
  userId: string,
  name: string,
  email: string,
) {
  execSql(
    "INSERT OR IGNORE INTO user (id, name, email) VALUES (?, ?, ?)",
    userId,
    name,
    email,
  );
  execSql(
    "INSERT INTO member (id, organization_id, user_id) VALUES (?, ?, ?)",
    `m-${organizationId}-${userId}`,
    organizationId,
    userId,
  );
}

export function execSql(statement: string, ...params: SQLInputValue[]) {
  if (!holder.database) throw new Error("Database not initialized");
  holder.database.prepare(statement).run(...params);
}

export function seedAsset(projectId: string, id: string, revision = 1) {
  execSql(
    `INSERT INTO content_assets (id, project_id, organization_id, title, search_intent, brief_markdown, body_html, meta_title, meta_description, generator, revision, created_by_user_id)
     VALUES (?, ?, 'org-1', 't', 'i', 'b', '<p>x</p>', 'm', 'd', 'template', ?, 'user-1')`,
    id,
    projectId,
    revision,
  );
}

export function seedOpportunity(projectId: string, id: string) {
  execSql(
    `INSERT INTO content_opportunities (id, project_id, organization_id, dedupe_key, query, impressions, clicks, ctr, position, window_start, window_end, recommended_action, reason, data_source)
     VALUES (?, ?, 'org-1', ?, 'q', 100, 2, 0.02, 8, '2026-10-01', '2026-10-28', 'new_article', 'r', 'gsc')`,
    id,
    projectId,
    `k-${id}`,
  );
  execSql(
    `INSERT INTO opportunity_evidence (id, opportunity_id, source, label, value, observed_at)
     VALUES (?, ?, 'gsc', 'Impressions', '100', '2026-10-28')`,
    `ev-${id}`,
    id,
  );
}

export function setAssetRevision(id: string, revision: number) {
  execSql("UPDATE content_assets SET revision = ? WHERE id = ?", revision, id);
}

export function setEntryColumn(
  id: string,
  column: string,
  value: string | number,
) {
  execSql(
    `UPDATE change_ledger_entries SET ${column} = ? WHERE id = ?`,
    value,
    id,
  );
}
