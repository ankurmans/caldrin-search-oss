import { beforeEach, expect, it, vi } from "vitest";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { projects } from "@/db/schema";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { AppError } from "@/server/lib/errors";
import { runScheduledAiVisibility } from "./scheduledAiVisibility";
import { configuration } from "./aiVisibilityTestFixtures";

const { testDb, workflow, assertTrialBudget } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return {
    testDb: await createAiVisibilityTestDb(),
    workflow: { create: vi.fn(), get: vi.fn() },
    assertTrialBudget: vi.fn(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1", AI_VISIBILITY_WORKFLOW: workflow },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => "dataforseo-key",
}));
vi.mock("@/server/features/workspace/trial", () => ({ assertTrialBudget }));
vi.mock("./aiVisibilityRetention", () => ({ pruneAiVisibility: vi.fn() }));

const due = "2026-09-01T06:00:00.000Z";
async function dueTracker(projectId: string, paused: boolean) {
  const rows = configuration(
    { engines: ["chatgpt"], prompts: [{ text: "Which SEO tools?", paused }] },
    projectId,
  );
  await repo.saveConfiguration(rows);
  await repo.updateTracker(rows.tracker.id, {
    enabled: true,
    nextCheckAt: due,
  });
}

beforeEach(async () => {
  assertTrialBudget.mockResolvedValue(undefined);
  await testDb.seedProject();
  await testDb.db.insert(projects).values({
    id: "paused-project",
    organizationId: "organization",
    name: "Paused",
    domain: "paused.example",
  });
});

it("moves every due tracker on, including one whose check cannot start", async () => {
  await dueTracker("paused-project", true);
  await dueTracker("project", false);

  await runScheduledAiVisibility();

  const skipped = await repo.getTracker("paused-project");
  expect(skipped?.nextCheckAt).not.toBe(due);
  expect(skipped?.lastSkipReason).toMatch(/unpause prompts/);
  expect((await repo.getTracker("project"))?.nextCheckAt).not.toBe(due);
  expect(await repo.listRuns("project")).toMatchObject([
    { trigger: "scheduled", status: "queued" },
  ]);
});

it("records a skipped check for an ended trial on the tracker without starting it", async () => {
  assertTrialBudget.mockRejectedValue(new AppError("TRIAL_ENDED"));
  await dueTracker("project", false);

  await runScheduledAiVisibility();

  expect((await repo.getTracker("project"))?.lastSkipReason).toBe(
    "TRIAL_ENDED",
  );
  expect(await repo.listRuns("project")).toEqual([]);
});

it("skips a scheduled check that would pass the project's spend limit, and records the cost of one that runs", async () => {
  await dueTracker("project", false);
  await SpendService.setLimits(
    { projectId: "project", organizationId: "organization", userId: "u" },
    { dailyUsd: 0.000001, monthlyUsd: null, scheduledJobsPerDay: null },
  );

  await runScheduledAiVisibility();

  expect((await repo.getTracker("project"))?.lastSkipReason).toMatch(
    /spend limit|limit/i,
  );
  expect(await repo.listRuns("project")).toEqual([]);

  await SpendService.setLimits(
    { projectId: "project", organizationId: "organization", userId: "u" },
    { dailyUsd: null, monthlyUsd: null, scheduledJobsPerDay: null },
  );
  await repo.updateTracker((await repo.getTracker("project")).id, {
    nextCheckAt: due,
  });
  await runScheduledAiVisibility();
  expect(await repo.listRuns("project")).toHaveLength(1);
  expect((await SpendService.getSpend("project")).todayUsd).toBeGreaterThan(0);
});
