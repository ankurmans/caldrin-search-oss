import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceMcpUsage,
  MCP_CALLS_PER_MINUTE,
  MCP_CLOUD_CALLS_PER_DAY,
} from "./usage-limit";

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
  delete state.workerEnv.MCP_CALLS_PER_MINUTE;
  delete state.workerEnv.MCP_CLOUD_CALLS_PER_DAY;
  vi.useFakeTimers({ now: new Date("2026-11-16T10:05:30Z") });
  state.workerEnv.AUTH_MODE = "password";
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  state.database.exec(`
    CREATE TABLE organization (id text PRIMARY KEY);
    INSERT INTO organization VALUES ('cloud-org'), ('byok-org');
  `);
  for (const file of [
    "drizzle/sqlite/0074_workspace_credentials.sql",
    "drizzle/sqlite/0077_daily_makkari.sql",
  ]) {
    state.database.exec(
      readFileSync(file, "utf8").replaceAll("--> statement-breakpoint", ""),
    );
  }
  state.database.exec(
    "INSERT INTO workspace_settings (organization_id, mode) VALUES ('cloud-org', 'cloud')",
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function seed(organizationId: string, bucket: string, count: number) {
  state.database?.exec(
    `INSERT INTO mcp_usage VALUES ('${organizationId}', '${bucket}', ${count})`,
  );
}

describe("MCP usage limits", () => {
  it("stops a workspace that exceeds the per-minute ceiling", async () => {
    seed("byok-org", "m:2026-11-16T10:05", MCP_CALLS_PER_MINUTE);
    await expect(enforceMcpUsage("byok-org")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("caps a workspace on the deployment's keys per day, not one on its own keys", async () => {
    seed("cloud-org", "d:2026-11-16", MCP_CLOUD_CALLS_PER_DAY);
    seed("byok-org", "d:2026-11-16", MCP_CLOUD_CALLS_PER_DAY);
    await expect(enforceMcpUsage("cloud-org")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await expect(enforceMcpUsage("byok-org")).resolves.toBeUndefined();
  });

  it("starts a fresh minute and drops the old bucket", async () => {
    seed("byok-org", "m:2026-11-16T10:04", MCP_CALLS_PER_MINUTE);
    await enforceMcpUsage("byok-org");
    const rows = state.database?.prepare("SELECT bucket FROM mcp_usage").all();
    expect(rows).toEqual([{ bucket: "m:2026-11-16T10:05" }]);
  });

  it("takes the per-minute and daily ceilings from the worker env", async () => {
    state.workerEnv.MCP_CALLS_PER_MINUTE = "5";
    state.workerEnv.MCP_CLOUD_CALLS_PER_DAY = "7";
    seed("byok-org", "m:2026-11-16T10:05", 5);
    seed("cloud-org", "d:2026-11-16", 7);
    await expect(enforceMcpUsage("byok-org")).rejects.toThrow(
      /5 requests per minute/,
    );
    await expect(enforceMcpUsage("cloud-org")).rejects.toThrow(
      /7 included calls/,
    );
  });

  it.each(["", "0", "-5", "1e3", "12 calls", "99999999999999999999", "abc"])(
    "keeps the defaults when the env value is %j",
    async (value) => {
      state.workerEnv.MCP_CALLS_PER_MINUTE = value;
      state.workerEnv.MCP_CLOUD_CALLS_PER_DAY = value;
      seed("byok-org", "m:2026-11-16T10:05", MCP_CALLS_PER_MINUTE - 1);
      seed("cloud-org", "d:2026-11-16", MCP_CLOUD_CALLS_PER_DAY);
      await expect(enforceMcpUsage("byok-org")).resolves.toBeUndefined();
      await expect(enforceMcpUsage("cloud-org")).rejects.toThrow(
        new RegExp(`${MCP_CLOUD_CALLS_PER_DAY} included`),
      );
    },
  );
});
