import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { AiMeasurementService } from "./AiMeasurementService";
import { ensurePromptSetVersion } from "./aiPromptSetVersions";
import { saveTracker } from "./aiVisibilitySetup";
import { configuration } from "./aiVisibilityTestFixtures";
import { seedMeasurementRun, type Answer } from "./aiMeasurementTestSeed";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
// Ledger writes are covered in aiMeasurementLedger.test.ts.
vi.mock("@/server/features/ledger/services/LedgerService", () => ({
  LedgerService: {},
}));

const projectId = "project";

let trackerId: string;
let promptIds: string[];
let versionId: string;
const seedRun = (
  answers: Answer[],
  options: Parameters<typeof seedMeasurementRun>[3] = {},
) =>
  seedMeasurementRun(
    testDb.db,
    { trackerId, promptIds, versionId },
    answers,
    options,
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

const both = (answer: Partial<Answer> = {}): Answer[] =>
  [0, 1].map((prompt) => ({ prompt, ...answer }));

describe("compareWindows", () => {
  it("counts only answered observations and reports what it left out", async () => {
    const before = await seedRun([
      {
        prompt: 0,
        mentioned: true,
        cited: true,
        recommended: true,
        sources: ["https://caldrin.co/a", "https://docs.example/x"],
      },
      {
        prompt: 1,
        mentioned: false,
        sources: ["https://docs.example/x"],
        rivalMentioned: true,
      },
    ]);
    const after = await seedRun([
      {
        prompt: 0,
        mentioned: true,
        cited: false,
        recommended: false,
        model: "gpt-5",
        sources: ["https://docs.example/x"],
      },
      // None of these three says anything about the brand.
      { prompt: 1, text: null },
      { prompt: 0, engine: "gemini", status: "failed" },
      { prompt: 1, engine: "gemini", status: "pending" },
    ]);

    const result = await AiMeasurementService.compareWindows(projectId, {
      beforeRunIds: [before],
      afterRunIds: [after],
    });

    expect(result.attribution).toBe("observed_only");
    const [first, second] = [result.before.overall, result.after.overall];
    expect(first.mention).toMatchObject({ numerator: 1, denominator: 2 });
    expect(second.counts).toEqual({
      planned: 4,
      answered: 1,
      noAnswer: 1,
      failed: 1,
      pending: 1,
      excluded: 3,
    });
    expect(second.mention).toMatchObject({ numerator: 1, denominator: 1 });
    expect(second.ownCitation).toMatchObject({ numerator: 0, denominator: 1 });
    // Recommendation has its own denominator: answers with a detected verdict.
    expect(first.recommendation).toMatchObject({
      numerator: 1,
      denominator: 1,
    });
    expect(second.recommendation).toMatchObject({
      numerator: 0,
      denominator: 1,
    });
    expect(second.models).toEqual(["gpt-5"]);
    expect(first.competitors).toMatchObject([
      { domain: "rival.example", mention: { numerator: 1, denominator: 2 } },
    ]);
    expect(first.topCitedDomains).toMatchObject([
      { key: "docs.example", answers: 2 },
      { key: "caldrin.co", answers: 1 },
    ]);
    // Gemini is planned in the second run only, so the engine sets differ.
    expect(result.comparable).toBe(false);
    expect(result.reasons.map((r) => r.code)).toEqual(["engine_set_mismatch"]);
    expect(result.changes).toBeNull();
  });

  it("offers a change for the same prompt set and flags too few repeat runs", async () => {
    const before = await seedRun(both({ mentioned: false }));
    const after = await seedRun(both({ mentioned: true }));

    const result = await AiMeasurementService.compareWindows(projectId, {
      beforeRunIds: [before],
      afterRunIds: [after],
    });

    expect(result.comparable).toBe(true);
    expect(result.reliability).toBe("single_run");
    expect(result.changes?.overall.mention).toMatchObject({
      difference: 1,
      verdict: "insufficient_runs",
    });
    expect(result.before.promptSetVersionIds).toEqual([versionId]);
  });

  it("calls a difference real only with enough repeat runs and non-overlapping intervals", async () => {
    const seedMany = (mentioned: boolean, createdAt: string) =>
      Promise.all(
        Array.from({ length: 10 }, () =>
          seedRun(both({ mentioned }), { createdAt }),
        ),
      );
    await seedMany(false, "2026-10-01T00:00:00.000Z");
    await seedMany(true, "2026-10-20T00:00:00.000Z");
    await seedMany(false, "2026-11-01T00:00:00.000Z");

    const changed = await AiMeasurementService.compareWindows(projectId, {
      beforeWindow: {
        start: "2026-09-30T00:00:00Z",
        end: "2026-10-02T00:00:00Z",
      },
      afterWindow: {
        start: "2026-10-19T00:00:00Z",
        end: "2026-10-21T00:00:00Z",
      },
    });
    const steady = await AiMeasurementService.compareWindows(projectId, {
      beforeWindow: {
        start: "2026-09-30T00:00:00Z",
        end: "2026-10-02T00:00:00Z",
      },
      afterWindow: {
        start: "2026-10-31T00:00:00Z",
        end: "2026-11-02T00:00:00Z",
      },
    });

    expect(changed.reliability).toBe("below_client_number_floor");
    expect(changed.changes?.overall.mention.verdict).toBe("outside_noise");
    expect(steady.changes?.overall.mention.verdict).toBe("within_noise");
  });

  it("refuses to compare different prompt-set versions or unversioned runs", async () => {
    const before = await seedRun(both());
    await saveTracker({ projectId, prompts: [{ text: "A third prompt?" }] });
    const config = (await repo.getConfiguration(projectId))!;
    const newVersion = await ensurePromptSetVersion(
      trackerId,
      config.prompts.map((p) => p.id),
    );
    const after = await seedRun(both(), { version: newVersion });
    const legacy = await seedRun(both(), { version: null });

    const changed = await AiMeasurementService.compareWindows(projectId, {
      beforeRunIds: [before],
      afterRunIds: [after],
    });
    const unversioned = await AiMeasurementService.compareWindows(projectId, {
      beforeRunIds: [legacy],
      afterRunIds: [before],
    });

    expect(changed).toMatchObject({ comparable: false, changes: null });
    expect(changed.reasons.map((r) => r.code)).toContain(
      "prompt_set_version_mismatch",
    );
    expect(unversioned.comparable).toBe(false);
    expect(unversioned.reasons.map((r) => r.code)).toContain(
      "unversioned_runs",
    );
  });

  it("compares one market at a time", async () => {
    const window = {
      start: "2026-09-01T00:00:00Z",
      end: "2026-12-01T00:00:00Z",
    };
    const us = await seedRun(both({ mentioned: true }));
    const uk = await seedRun(both(), { locationCode: 2826 });

    const mixed = await AiMeasurementService.compareWindows(projectId, {
      beforeWindow: window,
      afterWindow: window,
    });
    const ukOnly = await AiMeasurementService.compareWindows(projectId, {
      beforeWindow: window,
      afterWindow: window,
      locationCode: 2826,
    });
    const crossed = await AiMeasurementService.compareWindows(projectId, {
      beforeRunIds: [us],
      afterRunIds: [uk],
    });

    expect(mixed.reasons.map((r) => r.code)).toContain("mixed_markets");
    expect(ukOnly.before.runIds).toEqual([uk]);
    expect(crossed.reasons.map((r) => r.code)).toContain("market_mismatch");
  });

  it("never reads another project's runs", async () => {
    const mine = await seedRun(both({ mentioned: true }));
    const foreign = await seedRun(both(), {
      project: "other",
      version: null,
    });

    await expect(
      AiMeasurementService.compareWindows(projectId, {
        beforeRunIds: [mine],
        afterRunIds: [foreign],
      }),
    ).rejects.toMatchObject({ reason: "RUN_NOT_FOUND" });
    const windowed = await AiMeasurementService.compareWindows(projectId, {
      beforeWindow: {
        start: "2026-09-01T00:00:00Z",
        end: "2026-12-01T00:00:00Z",
      },
      afterWindow: {
        start: "2026-09-01T00:00:00Z",
        end: "2026-12-01T00:00:00Z",
      },
    });
    expect(windowed.before.runIds).toEqual([mine]);
  });
});
