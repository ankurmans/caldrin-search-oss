import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { sort } from "remeda";
import { drizzle } from "drizzle-orm/sqlite-proxy";

// Test-only helpers: a real SQL database (node:sqlite) behind a drizzle proxy,
// built from every migration, so tenant-scoping bugs show up as real rows.

export function createMigratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  const files = sort(
    readdirSync("drizzle/sqlite").filter((name) => name.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  );
  for (const file of files) {
    const sql = readFileSync(`drizzle/sqlite/${file}`, "utf8");
    database.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  // Some migrations switch foreign keys back on. Ownership is enforced by
  // projectId scoping, which is what these tests probe, so rows need no parents.
  database.exec("PRAGMA foreign_keys = OFF");
  return database;
}

export function createProxyDb(getDatabase: () => DatabaseSync | null) {
  return drizzle(async (query, params, method) => {
    const database = getDatabase();
    if (!database) throw new Error("Database not initialized");
    const statement = database.prepare(query);
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
    return { rows: statement.all(...values).map((row) => Object.values(row)) };
  });
}
