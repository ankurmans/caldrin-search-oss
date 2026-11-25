import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { loadAiMetricRows } from "./aiMetricRows";
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

describe("loadAiMetricRows", () => {
  beforeEach(async () => {
    await testDb.seedProject();
  });

  it("leaves the brand columns empty when the engine gave no answer", async () => {
    const rows = configuration({
      engines: ["chatgpt"],
      prompts: [
        { text: "Best rank tracker?" },
        { text: "Cheapest rank tracker?" },
      ],
    });
    await repo.saveConfiguration(rows);
    const context = {
      trackerId: rows.tracker.id,
      promptIds: rows.prompts.map((p) => p.id),
      versionId: await ensurePromptSetVersion(
        rows.tracker.id,
        rows.prompts.map((p) => p.id),
      ),
    };
    const createdAt = new Date().toISOString();
    await seedMeasurementRun(
      testDb.db,
      context,
      [
        { prompt: 0, mentioned: true, rivalMentioned: true },
        { prompt: 1, text: null },
      ],
      { createdAt },
    );

    const { csv, rowCount, truncated } = await loadAiMetricRows({
      projectId: "project",
      days: 7,
    });

    const lines = csv.split("\r\n");
    expect(rowCount).toBe(2);
    expect(truncated).toBe(false);
    expect(lines[0]).toContain("brand_mentioned");
    expect(lines).toContain(
      `"${createdAt.slice(0, 10)}","${lines[1].split(",")[1].slice(1, -1)}","2840","en","General","Best rank tracker?","false","chatgpt","true","true","false","","1"`,
    );
    expect(lines.some((l) => l.endsWith('"chatgpt","false","","","",""'))).toBe(
      true,
    );
  });
});
