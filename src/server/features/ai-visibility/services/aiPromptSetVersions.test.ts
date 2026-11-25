import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiPromptSetMembers, aiPromptSetVersions } from "@/db/schema";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { ensureCurrentPromptSetVersion } from "./aiPromptSetVersions";
import { runCheck, startRun } from "./aiVisibilityRuns";
import { saveTracker } from "./aiVisibilitySetup";
import { configuration, customer } from "./aiVisibilityTestFixtures";

const { testDb, workflow } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return {
    testDb: await createAiVisibilityTestDb(),
    workflow: { create: vi.fn(), get: vi.fn() },
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

const projectId = "project";
const membersOf = async (versionId: string) =>
  (
    await testDb.db
      .select({ promptId: aiPromptSetMembers.promptId })
      .from(aiPromptSetMembers)
      .where(eq(aiPromptSetMembers.versionId, versionId))
  )
    .map((row) => row.promptId)
    .sort();
const versionNumbers = async () =>
  (await testDb.db.select().from(aiPromptSetVersions))
    .map((row) => row.version)
    .sort((a, b) => a - b);

let trackerId: string;
beforeEach(async () => {
  await testDb.seedProject();
  const rows = configuration({
    engines: ["chatgpt"],
    prompts: [{ text: "Which SEO tools?" }, { text: "Best rank tracker?" }],
  });
  trackerId = rows.tracker.id;
  await repo.saveConfiguration(rows);
  workflow.get.mockResolvedValue({
    status: async () => ({ status: "running" }),
  });
});

describe("prompt set versions", () => {
  it("creates a new version only when the active prompts change", async () => {
    const first = await ensureCurrentPromptSetVersion(trackerId);
    expect(await ensureCurrentPromptSetVersion(trackerId)).toBe(first);

    // A topic edit and a pause that is undone leave the same prompts active.
    const [a] = (await repo.getConfiguration(projectId))!.prompts;
    await saveTracker({
      projectId,
      prompts: [{ id: a.id, text: a.text, topic: "Rank tracking" }],
    });
    expect(await ensureCurrentPromptSetVersion(trackerId)).toBe(first);

    await saveTracker({
      projectId,
      prompts: [{ text: "Is Caldrin Search good?" }],
    });
    const second = await ensureCurrentPromptSetVersion(trackerId);
    expect(second).not.toBe(first);
    expect(await membersOf(second)).toHaveLength(3);
    expect(await membersOf(first)).toHaveLength(2);

    await saveTracker({
      projectId,
      prompts: [{ id: a.id, text: a.text, paused: true }],
    });
    const third = await ensureCurrentPromptSetVersion(trackerId);
    expect(await membersOf(third)).toHaveLength(2);
    expect(await versionNumbers()).toEqual([1, 2, 3]);
  });

  it.each(["baseline", "manual", "scheduled"] as const)(
    "stamps a %s run with the version of the prompts it measured",
    async (trigger) => {
      const config = (await repo.getConfiguration(projectId))!;
      const run =
        trigger === "manual"
          ? await runCheck({ projectId, maxCostUsd: 1 }, customer)
          : await startRun(config, trigger, customer);

      const stored = await repo.getRunInternal(run.id);
      expect(stored?.promptSetVersionId).toBe(
        await ensureCurrentPromptSetVersion(trackerId),
      );
      expect(await versionNumbers()).toEqual([1]);
    },
  );

  it("gives a manual check of a subset of the prompts its own version", async () => {
    const config = (await repo.getConfiguration(projectId))!;
    const full = await startRun(config, "baseline", customer);
    await repo.updateRun(full.id, { status: "completed" });

    const subset = await runCheck(
      { projectId, maxCostUsd: 1, promptIds: [config.prompts[0].id] },
      customer,
    );

    const [fullRun, subsetRun] = await Promise.all([
      repo.getRunInternal(full.id),
      repo.getRunInternal(subset.id),
    ]);
    expect(subsetRun?.promptSetVersionId).not.toBe(fullRun?.promptSetVersionId);
    expect(await membersOf(subsetRun.promptSetVersionId!)).toEqual([
      config.prompts[0].id,
    ]);
  });
});
