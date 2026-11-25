import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sort } from "remeda";

// Test-only: a real SQL database (node:sqlite) behind a drizzle proxy, built
// from every sqlite migration, so scoping and state-machine bugs show up as
// real rows instead of mock behavior.

let database: DatabaseSync | null = null;

export function resetDatabase(): void {
  database?.close();
  database = new DatabaseSync(":memory:");
  const files = sort(
    readdirSync("drizzle/sqlite").filter((name) => name.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  );
  for (const file of files) {
    database.exec(
      readFileSync(`drizzle/sqlite/${file}`, "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  // Ownership is enforced by projectId scoping, which is what these test.
  database.exec("PRAGMA foreign_keys = OFF");
}

export function selectAll(table: string): unknown[] {
  if (!database) throw new Error("Database not initialized");
  return database.prepare(`SELECT * FROM ${table}`).all();
}

export function contentDbMock() {
  return {
    db: drizzle(async (query, params, method) => {
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
      return {
        rows: statement.all(...values).map((row) => Object.values(row)),
      };
    }),
  };
}
