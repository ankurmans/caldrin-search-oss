import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { SpendService } from "./SpendService";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  workerEnv: {} as Record<string, string>,
}));
vi.mock("cloudflare:workers", () => ({ env: state.workerEnv }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});

const scopeA = {
  projectId: "project-a",
  organizationId: "org-1",
  userId: "u1",
};
const scopeB = {
  projectId: "project-b",
  organizationId: "org-2",
  userId: "u2",
};
// Another project in the first workspace.
const scopeB2 = { ...scopeA, projectId: "project-b" };
const noLimits = {
  dailyUsd: null,
  monthlyUsd: null,
  scheduledJobsPerDay: null,
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-16T10:05:30Z") });
  state.database?.close();
  state.database = createMigratedDatabase();
});

afterEach(() => {
  vi.useRealTimers();
});

// Rows as SQLite's own default writes them ("YYYY-MM-DD HH:MM:SS"), and as
// Postgres/recordCost write them (ISO), to prove both compare correctly.
function seedCost(
  projectId: string,
  createdAt: string,
  costUsd: number,
  operation = "serp",
) {
  state.database?.exec(
    `INSERT INTO provider_costs (id, project_id, organization_id, provider, operation, cost_usd, created_at)
     VALUES ('${crypto.randomUUID()}', '${projectId}', 'org-1', 'dataforseo', '${operation}', ${costUsd}, '${createdAt}')`,
  );
}

describe("spend windows", () => {
  it("counts UTC day and month on both timestamp formats and ignores other projects", async () => {
    seedCost("project-a", "2026-11-16 00:00:00", 1); // sqlite format, today
    seedCost("project-a", "2026-11-16T23:59:59.000Z", 2); // iso format, today
    seedCost("project-a", "2026-11-15 23:59:59", 4); // yesterday, this month
    seedCost("project-a", "2026-10-31T23:59:59.000Z", 8); // last month
    seedCost("project-b", "2026-11-16 09:00:00", 16);
    const spend = await SpendService.getSpend("project-a");
    expect(spend.todayUsd).toBe(3);
    expect(spend.monthUsd).toBe(7);
    expect(spend.byProvider).toEqual([
      { provider: "dataforseo", todayUsd: 3, monthUsd: 7 },
    ]);
  });
});

describe("assertWithinLimits", () => {
  it("allows everything when no limit is set, even without an estimate", async () => {
    await expect(
      SpendService.assertWithinLimits(scopeA, {
        estimatedUsd: null,
        provider: "dataforseo",
        operation: "serp",
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses when recorded spend plus the estimate passes the daily limit, naming all three numbers", async () => {
    await SpendService.setLimits(scopeA, { ...noLimits, dailyUsd: 1 });
    await SpendService.recordCost(scopeA, {
      provider: "dataforseo",
      operation: "serp",
      costUsd: 0.8,
    });
    await expect(
      SpendService.assertWithinLimits(scopeA, {
        estimatedUsd: 0.3,
        provider: "dataforseo",
        operation: "serp",
      }),
    ).rejects.toThrow(
      /daily spend limit of \$1\.0000.*spent \$0\.8000.*\$0\.3000/,
    );
    await expect(
      SpendService.assertWithinLimits(scopeA, {
        estimatedUsd: 0.2,
        provider: "dataforseo",
        operation: "serp",
      }),
    ).resolves.toBeUndefined();
  });

  it("enforces the monthly limit when the day is fine", async () => {
    await SpendService.setLimits(scopeA, { ...noLimits, monthlyUsd: 10 });
    seedCost("project-a", "2026-11-02 08:00:00", 9.9);
    await expect(
      SpendService.assertWithinLimits(scopeA, {
        estimatedUsd: 0.2,
        provider: "llm",
        operation: "llm_draft",
      }),
    ).rejects.toThrow(/monthly spend limit/);
  });

  it("refuses an unknown estimate when a limit exists", async () => {
    await SpendService.setLimits(scopeA, { ...noLimits, dailyUsd: 5 });
    await expect(
      SpendService.assertWithinLimits(scopeA, {
        estimatedUsd: null,
        provider: "dataforseo",
        operation: "serp",
      }),
    ).rejects.toThrow(/no cost estimate/);
  });

  it("refuses a negative or non-finite estimate instead of letting it lower the total", async () => {
    await SpendService.setLimits(scopeA, { ...noLimits, dailyUsd: 5 });
    for (const estimatedUsd of [-1, Number.NaN]) {
      await expect(
        SpendService.assertWithinLimits(scopeA, {
          estimatedUsd,
          provider: "llm",
          operation: "llm_draft",
        }),
      ).rejects.toMatchObject({ name: "SpendLimitRefusal" });
    }
  });

  it("fails closed when spend cannot be read", async () => {
    await SpendService.setLimits(scopeA, { ...noLimits, dailyUsd: 5 });
    state.database?.exec("DROP TABLE provider_costs");
    await expect(
      SpendService.assertWithinLimits(scopeA, {
        estimatedUsd: 0.01,
        provider: "dataforseo",
        operation: "serp",
      }),
    ).rejects.toThrow(/could not be verified/);
  });

  it("fails closed when limits cannot be read, even though none may exist", async () => {
    state.database?.exec("DROP TABLE project_spend_limits");
    await expect(
      SpendService.assertWithinLimits(scopeA, {
        estimatedUsd: 0.01,
        provider: "dataforseo",
        operation: "serp",
      }),
    ).rejects.toThrow(/could not be verified/);
  });

  it("does not apply one project's limit or spend to another", async () => {
    await SpendService.setLimits(scopeA, { ...noLimits, dailyUsd: 0.01 });
    seedCost("project-a", "2026-11-16 09:00:00", 5);
    await expect(
      SpendService.assertWithinLimits(scopeB, {
        estimatedUsd: 100,
        provider: "dataforseo",
        operation: "serp",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("limits and cost records", () => {
  it("rejects limits that are negative or fractional job counts", async () => {
    await expect(
      SpendService.setLimits(scopeA, { ...noLimits, dailyUsd: -1 }),
    ).rejects.toMatchObject({ name: "SpendLimitRefusal" });
    await expect(
      SpendService.setLimits(scopeA, { ...noLimits, scheduledJobsPerDay: 1.5 }),
    ).rejects.toMatchObject({ name: "SpendLimitRefusal" });
  });

  it("clears a limit when set back to null", async () => {
    await SpendService.setLimits(scopeA, { ...noLimits, dailyUsd: 1 });
    expect(await SpendService.setLimits(scopeA, noLimits)).toEqual(noLimits);
  });

  it("refuses to attach a cost to another project's ledger entry", async () => {
    state.database?.exec(
      `INSERT INTO change_ledger_entries (id, project_id, organization_id, kind, provider, proposed_action, requested_by_user_id)
       VALUES ('entry-b', 'project-b', 'org-2', 'content_publish', 'shopify', 'x', 'u2')`,
    );
    await expect(
      SpendService.recordCost(scopeA, {
        provider: "llm",
        operation: "llm_draft",
        costUsd: 0.1,
        ledgerEntryId: "entry-b",
      }),
    ).rejects.toThrow(/not in this project/);
  });
});

describe("scheduled jobs", () => {
  it("stops scheduled runs at the daily count, resets next UTC day, and is per project", async () => {
    await SpendService.setLimits(scopeA, {
      ...noLimits,
      scheduledJobsPerDay: 2,
    });
    await SpendService.recordScheduledRun(scopeA, "rank_check");
    await SpendService.assertScheduledJobAllowed(scopeA, "rank_check");
    await SpendService.recordScheduledRun(scopeA, "ai_visibility");
    await expect(
      SpendService.assertScheduledJobAllowed(scopeA, "rank_check"),
    ).rejects.toThrow(/limit is 2/);
    // Manual paid operations are not scheduled runs.
    seedCost("project-a", "2026-11-16 09:00:00", 1, "serp");
    await expect(
      SpendService.assertScheduledJobAllowed(scopeB, "rank_check"),
    ).resolves.toBeUndefined();
    vi.setSystemTime(new Date("2026-11-17T00:00:01Z"));
    await expect(
      SpendService.assertScheduledJobAllowed(scopeA, "rank_check"),
    ).resolves.toBeUndefined();
  });
});

describe("a hosted plan's monthly allowance", () => {
  it("is shared by the workspace's projects and refuses what would pass it", async () => {
    state.database?.exec(
      "INSERT OR REPLACE INTO workspace_settings (organization_id, mode, plan) VALUES ('org-1', 'cloud', 'starter')",
    );
    seedCost("project-a", "2026-11-03 00:00:00", 1.2); // starter allows 1.50
    seedCost("project-b", "2026-10-30T00:00:00.000Z", 5); // last month: not counted
    const check = (estimatedUsd: number | null) =>
      SpendService.assertWithinLimits(scopeB2, {
        estimatedUsd,
        provider: "dataforseo",
        operation: "serp",
      });
    await expect(check(0.2)).resolves.toBeUndefined();
    await expect(check(0.4)).rejects.toThrow(/Starter plan allowance/);
    await expect(check(null)).rejects.toThrow(/no cost estimate/);
  });
});
