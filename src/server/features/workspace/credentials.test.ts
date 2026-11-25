import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkspaceMode } from "./credentials";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  workerEnv: {} as Record<string, string>,
}));
vi.mock("cloudflare:workers", () => ({ env: state.workerEnv }));
vi.mock("@/db", () => ({
  db: drizzle(async (query, params, method) => {
    if (!state.database) throw new Error("Database not initialized");
    const statement = state.database.prepare(query);
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
  }),
}));

beforeEach(() => {
  state.workerEnv.AUTH_MODE = "password";
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  state.database.exec(`
    CREATE TABLE organization (id text PRIMARY KEY);
    INSERT INTO organization VALUES ('org-old');
  `);
  state.database.exec(
    readFileSync(
      "drizzle/sqlite/0074_workspace_credentials.sql",
      "utf8",
    ).replaceAll("--> statement-breakpoint", ""),
  );
});

describe("which keys a workspace runs on", () => {
  it("runs a workspace with no settings row on its own keys", async () => {
    await expect(getWorkspaceMode("org-new")).resolves.toBe("byok");
  });

  it("keeps every workspace that existed before BYOK on the deployment's keys", async () => {
    state.database?.exec(
      readFileSync(
        "drizzle/sqlite/0076_grandfather_cloud_workspaces.sql",
        "utf8",
      ),
    );
    state.database?.exec("INSERT INTO organization VALUES ('org-signup')");
    await expect(getWorkspaceMode("org-old")).resolves.toBe("cloud");
    await expect(getWorkspaceMode("org-signup")).resolves.toBe("byok");
  });

  it("leaves modes that have no per-workspace keys on the deployment's", async () => {
    state.workerEnv.AUTH_MODE = "cloudflare_access";
    await expect(getWorkspaceMode("org-other")).resolves.toBe("cloud");
  });
});
