import { sort } from "remeda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { configuration } from "./aiVisibilityTestFixtures";
import { setMarkets } from "./aiVisibilityMarkets";
import { seedMeasurementRun } from "./aiMeasurementTestSeed";
import { ensurePromptSetVersion } from "./aiPromptSetVersions";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/provider-access", () => ({
  hasDataforseoAccess: async () => true,
}));

let trackerId: string;
const UK = { locationCode: 2826, languageCode: "en" };
const US = { locationCode: 2840, languageCode: "en" };

async function seedRun(location: number) {
  const id = await seedMeasurementRun(
    testDb.db,
    {
      trackerId,
      promptIds: [],
      versionId: await ensurePromptSetVersion(trackerId, []),
    },
    [],
  );
  await testDb.client.execute(
    `UPDATE ai_runs SET location_code = ${location} WHERE id = '${id}'`,
  );
  return id;
}

beforeEach(async () => {
  await testDb.seedProject();
  const rows = configuration({
    engines: ["chatgpt"],
    prompts: [{ text: "q" }],
  });
  await repo.saveConfiguration(rows);
  trackerId = rows.tracker.id;
});

describe("tracker markets", () => {
  it("reads as the tracker's own country once extra markets exist, and one market on request", async () => {
    const own = await seedRun(2840);
    const uk = await seedRun(2826);
    const ids = async (market?: { locationCode: number }) =>
      sort(
        (await repo.listRuns("project", 10, market)).map((run) => run.id),
        (a, b) => a.localeCompare(b),
      );

    expect(await ids()).toEqual(sort([own, uk], (a, b) => a.localeCompare(b)));

    await setMarkets({ projectId: "project", markets: [UK] });

    expect(await ids()).toEqual([own]);
    expect(await ids(UK)).toEqual([uk]);
  });

  it("allows one active check per market, not per tracker", async () => {
    await setMarkets({ projectId: "project", markets: [UK] });
    const start = (location: number) =>
      testDb.client.execute(
        `INSERT INTO ai_runs (id, tracker_id, project_id, trigger, status, location_code, language_code, created_at) VALUES ('r${location}${Math.random()}', '${trackerId}', 'project', 'manual', 'running', ${location}, 'en', '2026-11-01')`,
      );

    await start(2840);
    await start(2826);

    await expect(start(2826)).rejects.toThrow();
  });

  it("refuses the tracker's own market, a repeat, and a language the country lacks", async () => {
    await expect(
      setMarkets({ projectId: "project", markets: [US] }),
    ).rejects.toThrow(/differ/);
    await expect(
      setMarkets({ projectId: "project", markets: [UK, UK] }),
    ).rejects.toThrow(/differ/);
    await expect(
      setMarkets({
        projectId: "project",
        markets: [{ locationCode: 2826, languageCode: "bg" }],
      }),
    ).rejects.toThrow(/supports languageCode/);
  });
});
