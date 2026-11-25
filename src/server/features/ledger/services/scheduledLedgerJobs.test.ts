import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileStuckExecutions } from "@/server/features/content/services/shopifyReconcile";
import { GscService } from "@/server/features/gsc/services/GscService";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { GscNotConnectedError, GscTokenError } from "@/server/lib/gscErrors";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { collectGscObservations } from "./gscObservations";
import { runScheduledLedgerJobs } from "./scheduledLedgerJobs";
import {
  NOW,
  rows,
  seedEntry,
  seedGa4Connection,
} from "./scheduledTestSupport";

const state = vi.hoisted(() => ({ database: null as DatabaseSync | null }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: vi.fn() },
}));
vi.mock("@/server/features/content/services/shopifyReconcile", () => ({
  reconcileStuckExecutions: vi.fn(),
}));
// Wrapped, not replaced: it runs for real unless a test makes it throw.
vi.mock("./gscObservations", async (importOriginal) => {
  const actual = await importOriginal<{
    collectGscObservations: typeof collectGscObservations;
  }>();
  return { collectGscObservations: vi.fn(actual.collectGscObservations) };
});

const database = () => {
  if (!state.database) throw new Error("no database");
  return state.database;
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  state.database?.close();
  state.database = createMigratedDatabase();
  vi.mocked(GscService.getPerformance).mockImplementation(async (input) => ({
    siteUrl: "sc-domain:example.com",
    connectedBy: null,
    request: { startDate: "", endDate: "" },
    rows: [
      {
        keys: [`https://example.com${input.filters?.[0]?.expression}`],
        clicks: 20,
        impressions: 400,
        ctr: 0.05,
        position: 7,
      },
    ],
  }));
  vi.mocked(reconcileStuckExecutions).mockResolvedValue({
    checked: 0,
    markedExecuted: 0,
    markedFailed: 0,
    needsReview: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const observations = (entryId: string) =>
  rows(
    database(),
    `SELECT source, phase FROM change_ledger_observations WHERE entry_id = '${entryId}'`,
  );
const costOperations = (prefix: string) =>
  rows(
    database(),
    `SELECT operation, project_id, ledger_entry_id FROM provider_costs WHERE operation LIKE '${prefix}%'`,
  );

describe("daily Search Console readings", () => {
  it("reads only changes whose plan window has elapsed", async () => {
    seedEntry(database(), { id: "due" });
    seedEntry(database(), { id: "young", executedAt: "2026-11-12T12:00:00Z" });
    seedEntry(database(), { id: "long-plan", measurementWindowDays: 90 });
    seedEntry(database(), { id: "no-plan", measurementWindowDays: null });

    const report = await runScheduledLedgerJobs(NOW);

    expect(report.gsc).toMatchObject({
      attempted: 1,
      outcomes: { recorded: 1 },
    });
    expect(observations("due")).toHaveLength(8);
    for (const id of ["young", "long-plan", "no-plan"]) {
      expect(observations(id)).toEqual([]);
    }
  });

  it("records nothing twice when it runs again the same day", async () => {
    seedEntry(database(), { id: "due" });
    await runScheduledLedgerJobs(NOW);
    const second = await runScheduledLedgerJobs(NOW);

    expect(second.gsc.attempted).toBe(0);
    expect(observations("due")).toHaveLength(8);
    expect(costOperations("scheduled:ledger_gsc")).toHaveLength(1);
  });

  it("writes down no data, and retries it tomorrow rather than today", async () => {
    seedEntry(database(), { id: "quiet" });
    vi.mocked(GscService.getPerformance).mockResolvedValue({
      siteUrl: "x",
      connectedBy: null,
      request: { startDate: "", endDate: "" },
      rows: [],
    });

    const first = await runScheduledLedgerJobs(NOW);
    expect(first.gsc.outcomes).toEqual({ no_data: 1 });
    expect(observations("quiet")).toEqual([]);
    expect(costOperations("outcome:ledger_gsc:no_data")).toEqual([
      expect.objectContaining({ ledger_entry_id: "quiet" }),
    ]);

    expect((await runScheduledLedgerJobs(NOW)).gsc.attempted).toBe(0);
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    vi.setSystemTime(tomorrow);
    expect((await runScheduledLedgerJobs(tomorrow)).gsc.attempted).toBe(1);
  });

  it("stops retrying an entry after a week of empty readings", async () => {
    seedEntry(database(), { id: "never" });
    vi.mocked(GscService.getPerformance).mockResolvedValue({
      siteUrl: "x",
      connectedBy: null,
      request: { startDate: "", endDate: "" },
      rows: [],
    });
    let attempts = 0;
    for (let day = 0; day < 10; day += 1) {
      const at = new Date(NOW.getTime() + day * 86_400_000);
      vi.setSystemTime(at);
      attempts += (await runScheduledLedgerJobs(at)).gsc.attempted;
    }
    expect(attempts).toBe(7);
  });

  it("records unavailable when Search Console is missing or revoked", async () => {
    seedEntry(database(), { id: "missing" });
    seedEntry(database(), { id: "revoked", projectId: "project-b" });
    vi.mocked(GscService.getPerformance).mockImplementation(async (input) => {
      throw input.projectId === "project-a"
        ? new GscNotConnectedError("project-a")
        : new GscTokenError("revoked");
    });

    const report = await runScheduledLedgerJobs(NOW);

    expect(report.gsc.outcomes).toEqual({ unavailable: 2 });
    expect(observations("missing")).toEqual([]);
    expect(observations("revoked")).toEqual([]);
    expect(costOperations("outcome:ledger_gsc:unavailable")).toHaveLength(2);
  });

  it("skips rolled-back and unpublished changes", async () => {
    seedEntry(database(), { id: "undone", status: "rolled_back" });
    seedEntry(database(), { id: "draft", publicationStatus: "draft" });

    const report = await runScheduledLedgerJobs(NOW);

    expect(report.gsc.attempted).toBe(0);
    expect(GscService.getPerformance).not.toHaveBeenCalled();
  });

  it("lets one failing entry fail alone", async () => {
    seedEntry(database(), {
      id: "a-breaks",
      executedAt: "2026-09-01T12:00:00Z",
    });
    seedEntry(database(), { id: "b-fine" });
    vi.mocked(collectGscObservations).mockRejectedValueOnce(new Error("boom"));

    const report = await runScheduledLedgerJobs(NOW);

    expect(report.gsc.outcomes).toEqual({ failed: 1, recorded: 1 });
    expect(observations("a-breaks")).toEqual([]);
    expect(observations("b-fine")).toHaveLength(8);
    expect(costOperations("outcome:ledger_gsc:failed")).toEqual([
      expect.objectContaining({ ledger_entry_id: "a-breaks" }),
    ]);
  });
});

describe("scheduled-jobs-per-day limit", () => {
  it("stops a project at its limit, says so once, and leaves other projects running", async () => {
    await SpendService.setLimits(
      { projectId: "project-a", organizationId: "o", userId: "u" },
      { dailyUsd: null, monthlyUsd: null, scheduledJobsPerDay: 1 },
    );
    seedEntry(database(), { id: "a1", executedAt: "2026-09-01T12:00:00Z" });
    seedEntry(database(), { id: "a2" });
    seedEntry(database(), { id: "b1", projectId: "project-b" });

    const report = await runScheduledLedgerJobs(NOW);

    expect(report.gsc).toMatchObject({ attempted: 2, skippedForLimit: 1 });
    expect(report.projectsAtLimit).toEqual(["project-a"]);
    expect(observations("a1")).toHaveLength(8);
    expect(observations("a2")).toEqual([]);
    expect(observations("b1")).toHaveLength(8);

    await runScheduledLedgerJobs(NOW);
    expect(costOperations("skipped:scheduled_limit")).toEqual([
      expect.objectContaining({ project_id: "project-a" }),
    ]);
    expect(costOperations("scheduled:ledger_gsc")).toHaveLength(2);
  });
});

describe("Google Analytics second step", () => {
  it("is not a job for a project without Google Analytics", async () => {
    seedEntry(database(), { id: "plain" });
    seedEntry(database(), { id: "wired", projectId: "project-b" });
    seedGa4Connection(database(), "project-b");

    const report = await runScheduledLedgerJobs(NOW);

    // The wired project is attempted; with no Google grant behind it the
    // read comes back unavailable and nothing is invented.
    expect(report.ga4).toMatchObject({ attempted: 1, notConnected: 1 });
    expect(report.ga4.outcomes).toEqual({ unavailable: 1 });
    expect(observations("wired").map((o) => o.source)).not.toContain("ga4");
  });
});

describe("stuck Shopify executions", () => {
  it("reconciles per project and counts each against the limit", async () => {
    seedEntry(database(), {
      id: "stuck",
      status: "executing",
      updatedAt: "2026-11-16 09:00:00",
    });
    seedEntry(database(), {
      id: "fresh",
      projectId: "project-c",
      status: "executing",
      updatedAt: "2026-11-16 09:58:00",
    });
    seedEntry(database(), {
      id: "limited",
      projectId: "project-d",
      status: "executing",
      updatedAt: "2026-11-16 09:00:00",
    });
    await SpendService.setLimits(
      { projectId: "project-d", organizationId: "o", userId: "u" },
      { dailyUsd: null, monthlyUsd: null, scheduledJobsPerDay: 0 },
    );
    vi.mocked(reconcileStuckExecutions).mockResolvedValue({
      checked: 1,
      markedExecuted: 1,
      markedFailed: 0,
      needsReview: 0,
    });

    const report = await runScheduledLedgerJobs(NOW);

    expect(reconcileStuckExecutions).toHaveBeenCalledTimes(1);
    expect(reconcileStuckExecutions).toHaveBeenCalledWith({
      olderThanMinutes: 15,
      projectId: "project-a",
    });
    expect(report.reconcile).toMatchObject({
      projects: 1,
      markedExecuted: 1,
      skippedForLimit: 1,
    });
  });
});
