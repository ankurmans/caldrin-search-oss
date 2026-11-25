import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { AiMeasurementService } from "./AiMeasurementService";
import { ensurePromptSetVersion } from "./aiPromptSetVersions";
import { configuration } from "./aiVisibilityTestFixtures";
import { seedMeasurementRun } from "./aiMeasurementTestSeed";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/features/ledger/services/LedgerService", () => ({
  LedgerService: {},
}));

let trackerId: string;
let promptIds: string[];
let versionId: string;
const seed = (
  createdAt: string,
  options: Parameters<typeof seedMeasurementRun>[3] = {},
  engine: "chatgpt" | "gemini" = "chatgpt",
) =>
  seedMeasurementRun(
    testDb.db,
    { trackerId, promptIds, versionId },
    [0, 1].map((prompt) => ({ prompt, engine, model: "gpt-5" })),
    { createdAt, ...options },
  );

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.client.execute(
    "INSERT INTO projects (id, organization_id, name, domain) VALUES ('other', 'organization', 'Other', 'other.example')",
  );
  const rows = configuration({
    engines: ["chatgpt", "gemini"],
    prompts: [{ text: "Which SEO tools?" }, { text: "Best rank tracker?" }],
  });
  await repo.saveConfiguration(rows);
  trackerId = rows.tracker.id;
  promptIds = rows.prompts.map((p) => p.id);
  versionId = await ensurePromptSetVersion(trackerId, promptIds);
});

describe("listRuns", () => {
  it("lists this project's finished runs only, newest first, with their prompt set", async () => {
    const older = await seed("2026-10-01T00:00:00.000Z");
    const newer = await seed("2026-10-08T00:00:00.000Z", {}, "gemini");
    const old = await seed("2026-09-01T00:00:00.000Z", { version: null });
    const failed = await seed("2026-10-09T00:00:00.000Z");
    const running = await seed("2026-10-10T00:00:00.000Z");
    await testDb.client.execute(
      `UPDATE ai_runs SET status = 'failed' WHERE id = '${failed}'`,
    );
    await testDb.client.execute(
      `UPDATE ai_runs SET status = 'running' WHERE id = '${running}'`,
    );
    // Another project's run must never appear, even in the same tracker.
    await seed("2026-10-05T00:00:00.000Z", { project: "other" });

    const { runs, truncated } = await AiMeasurementService.listRuns(
      "project",
      {},
    );
    expect(truncated).toBe(false);
    expect(runs.map((run) => run.id)).toEqual([newer, older, old]);
    expect(runs[0]).toMatchObject({
      engines: ["gemini"],
      models: ["gpt-5"],
      promptsCount: 2,
      promptSetVersionId: versionId,
      promptSetLabel: "Prompt set v1",
      status: "completed",
      trackerId,
    });
    expect(runs[2]).toMatchObject({
      promptSetVersionId: null,
      promptSetLabel: "Before prompt-set versioning",
    });
    // Same prompt set but a different engine is a different comparable set.
    expect(runs[0].comparableKey).not.toBe(runs[1].comparableKey);
  });

  it("limits the list to the requested range", async () => {
    await seed("2026-10-01T00:00:00.000Z");
    const inside = await seed("2026-10-08T00:00:00.000Z");
    await seed("2026-10-20T00:00:00.000Z");
    const { runs } = await AiMeasurementService.listRuns("project", {
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-10T00:00:00.000Z",
    });
    expect(runs.map((run) => run.id)).toEqual([inside]);
  });
});
