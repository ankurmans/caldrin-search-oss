import { readFileSync } from "node:fs";
import type { Client, InValue } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SpendLimitRefusal } from "@/server/features/spend/services/SpendService";
import { LocalSeoService } from "./LocalSeoService";
import { localOverview } from "./localOverview";
import { runScheduledLocalChecks } from "./scheduledLocalChecks";

const mocks = vi.hoisted(() => ({
  client: null as Client | null,
  database: null as LibSQLDatabase | null,
  createWorkflow: vi.fn(),
  assertWithinLimits: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  mocks.client = createClient({ url: "file::memory:" });
  mocks.database = drizzle(mocks.client);
  return { db: mocks.database };
});
vi.mock("@/db/runBatch", () => ({
  runBatch: async (
    build: (
      tx: Pick<LibSQLDatabase, "insert" | "update" | "delete">,
    ) => { toSQL: () => { sql: string; params: InValue[] } }[],
  ) => {
    if (!mocks.database || !mocks.client)
      throw new Error("Database not initialized");
    await mocks.client.batch(
      build(mocks.database).map((query) => {
        const { sql, params } = query.toSQL();
        return { sql, args: params };
      }),
      "write",
    );
  },
}));
vi.mock("cloudflare:workers", () => ({
  env: { LOCAL_RANK_WORKFLOW: { create: mocks.createWorkflow } },
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({ serp: {} }),
}));
vi.mock("@/server/features/workspace/trial", () => ({
  assertTrialBudget: async () => undefined,
}));
vi.mock("@/server/features/spend/services/SpendService", () => ({
  SpendLimitRefusal: class extends Error {},
  SpendService: {
    assertScheduledJobAllowed: async () => undefined,
    assertWithinLimits: mocks.assertWithinLimits,
    recordCost: async () => undefined,
  },
}));

const client = mocks.client;
if (!client) throw new Error("Database not initialized");
const projectId = "project-a";

beforeAll(async () => {
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, archived_at TEXT);
    ${readFileSync("drizzle/sqlite/0060_reflective_wrecker.sql", "utf8")}
    ${readFileSync("drizzle/sqlite/0099_hard_maginty.sql", "utf8")}
  `);
});
afterAll(() => client.close());
beforeEach(async () => {
  mocks.createWorkflow.mockResolvedValue({ id: "workflow" });
  mocks.assertWithinLimits.mockResolvedValue(undefined);
  await client.executeMultiple(
    "DELETE FROM projects; INSERT INTO projects VALUES ('project-a', 'org-a', NULL);",
  );
});

/** A tracker on a weekly schedule whose next check was due long ago. */
const dueTracker = async () => {
  const tracker = await LocalSeoService.createTracker(
    {
      projectId,
      business: {
        title: "Branch Books",
        address: "Portland",
        cid: "own-listing",
        placeId: null,
        latitude: 45.52,
        longitude: -122.68,
      },
      keywords: ["bookstore"],
      gridSize: 3,
      spacingKm: 2,
    },
    "en",
  );
  await LocalSeoService.setSchedule({
    projectId,
    trackerId: tracker.id,
    interval: "weekly",
  });
  await client.execute({
    sql: "UPDATE local_rank_trackers SET next_check_at = '2020-01-01T00:00:00.000Z' WHERE id = ?",
    args: [tracker.id],
  });
  return tracker.id;
};

const savedTracker = async (trackerId: string) =>
  (await LocalSeoService.getTracker(projectId, trackerId)).tracker;

describe("scheduled local checks", () => {
  it("starts a due check once and moves the schedule on", async () => {
    const trackerId = await dueTracker();

    expect(await runScheduledLocalChecks()).toEqual({ started: 1 });
    expect(await runScheduledLocalChecks()).toEqual({ started: 0 });

    expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
    const saved = await savedTracker(trackerId);
    expect(saved.nextCheckAt! > new Date().toISOString()).toBe(true);
  });

  it("starts nothing and says why when a spend limit refuses it", async () => {
    const trackerId = await dueTracker();
    mocks.assertWithinLimits.mockRejectedValue(
      new SpendLimitRefusal("Monthly limit reached."),
    );

    expect(await runScheduledLocalChecks()).toEqual({ started: 0 });

    expect(mocks.createWorkflow).not.toHaveBeenCalled();
    const saved = await savedTracker(trackerId);
    expect(saved.lastSkipReason).toBe("Monthly limit reached.");
    // A skipped tracker must leave the due queue, or enough of them starve it.
    expect(saved.nextCheckAt! > new Date().toISOString()).toBe(true);
  });

  it("lists every location with its schedule without starting a check", async () => {
    const trackerId = await dueTracker();

    const { locations } = await localOverview(projectId);

    expect(locations).toMatchObject([
      { trackerId, schedule: "weekly", top3Percent: null, latestCheckAt: null },
    ]);
    expect(mocks.createWorkflow).not.toHaveBeenCalled();
  });
});
