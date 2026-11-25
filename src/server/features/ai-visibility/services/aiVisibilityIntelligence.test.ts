import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiEvidencePageSchema,
  aiIntelligenceSchema,
} from "@/types/schemas/ai-visibility-intelligence";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { ensurePromptSetVersion } from "./aiPromptSetVersions";
import { loadAiEvidencePage } from "./aiIntelligenceEvidence";
import { loadAiIntelligence } from "./aiVisibilityIntelligence";
import { configuration } from "./aiVisibilityTestFixtures";
import { seedMeasurementRun, type Answer } from "./aiMeasurementTestSeed";
import { aiObservations, aiPerceptions } from "@/db/schema";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

let trackerId: string;
let promptIds: string[];
let versionId: string;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();
const seed = (
  answers: Answer[],
  options: Parameters<typeof seedMeasurementRun>[3] = {},
) =>
  seedMeasurementRun(testDb.db, { trackerId, promptIds, versionId }, answers, {
    createdAt: daysAgo(2),
    ...options,
  });
const load = (input: Record<string, unknown> = {}) =>
  loadAiIntelligence(
    aiIntelligenceSchema.parse({
      projectId: "00000000-0000-4000-8000-000000000001",
      ...input,
    }),
  );

const evidence = (input: Record<string, unknown> = {}) =>
  loadAiEvidencePage(
    aiEvidencePageSchema.parse({
      projectId: "00000000-0000-4000-8000-000000000001",
      ...input,
    }),
  );

beforeEach(async () => {
  await testDb.seedProject();
  // The schema wants a uuid; the seeded project is renamed to one.
  await testDb.client.executeMultiple(`
    UPDATE projects SET id = '00000000-0000-4000-8000-000000000001' WHERE id = 'project';
    INSERT INTO projects (id, organization_id, name, domain) VALUES ('other', 'organization', 'Other', 'other.example');
  `);
  const rows = configuration(
    {
      engines: ["chatgpt", "gemini"],
      prompts: [{ text: "Which SEO tools?" }, { text: "Best rank tracker?" }],
    },
    "00000000-0000-4000-8000-000000000001",
  );
  await repo.saveConfiguration(rows);
  trackerId = rows.tracker.id;
  promptIds = rows.prompts.map((p) => p.id);
  versionId = await ensurePromptSetVersion(trackerId, promptIds);
});

const PROJECT = { project: "00000000-0000-4000-8000-000000000001" };

describe("loadAiIntelligence", () => {
  it("counts an answer read as recommending the brand even where no phrase said so", async () => {
    const runId = await seed([{ prompt: 0, mentioned: true }], PROJECT);
    const [observation] = await testDb.db
      .select({ id: aiObservations.id })
      .from(aiObservations)
      .where(eq(aiObservations.runId, runId));
    expect((await load()).target?.recommendation.numerator).toBe(0);

    await testDb.db.insert(aiPerceptions).values({
      id: "perception",
      observationId: observation.id,
      domain: "caldrin.co",
      name: "Caldrin Search",
      own: true,
      stance: "recommended",
      sentiment: "positive",
      confidence: "high",
      evidence: null,
      ambiguousName: false,
      classifierVersion: "perception-1",
      model: "small-model",
      classifiedAt: daysAgo(1),
    });
    expect((await load()).target?.recommendation.numerator).toBe(1);
  });

  it("reads only this project's runs", async () => {
    await seed([{ prompt: 0 }], PROJECT);
    await seed([{ prompt: 0, mentioned: true }], { project: "other" });

    const result = await load();

    expect(result.coverage.answered).toBe(1);
    expect(result.target?.mention.numerator).toBe(0);
  });

  it("measures the newest prompt set only and breaks the trend where it changed", async () => {
    await seed([{ prompt: 0, mentioned: true }], {
      ...PROJECT,
      createdAt: daysAgo(5),
    });
    const newer = await ensurePromptSetVersion(trackerId, [promptIds[0]]);
    await seed([{ prompt: 0 }], { ...PROJECT, version: newer });

    const result = await load();

    expect(result.promptSet).toMatchObject({
      selectedVersionId: newer,
      excludedRuns: 1,
    });
    expect(result.target?.mention).toEqual({
      numerator: 0,
      denominator: 1,
      rate: 0,
    });
    expect(result.trend.map((p) => p.promptSetVersionId)).toEqual([
      versionId,
      newer,
    ]);
    expect(result.warnings.join(" ")).toMatch(/different prompt set/);
  });

  it("applies filters to the scorecard, leaderboard and evidence together", async () => {
    await seed(
      [
        { prompt: 0, engine: "chatgpt", mentioned: true, rivalMentioned: true },
        { prompt: 1, engine: "gemini", mentioned: false, rivalMentioned: true },
        { prompt: 0, engine: "gemini", status: "failed" },
      ],
      PROJECT,
    );

    const result = await load({ engines: ["gemini"] });

    expect(result.coverage).toMatchObject({
      answered: 1,
      failed: 1,
      engines: ["gemini"],
    });
    const rival = result.leaderboard.find((b) => !b.own)!;
    expect(rival.shareOfVoice).toEqual({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
    expect(result.target?.answers).toBe(1);
    const page = await evidence({ engines: ["gemini"] });
    const evidenceAnswers = page.prompts.flatMap((p) => p.answers);
    expect(evidenceAnswers).toHaveLength(1);
    expect(evidenceAnswers[0]).toMatchObject({
      engine: "gemini",
      mentioned: false,
    });
  });

  it("filters figures and evidence by intent, with unset intents as unknown", async () => {
    await testDb.client.execute({
      sql: "UPDATE ai_prompts SET intent = 'comparison' WHERE id = ?",
      args: [promptIds[1]],
    });
    await seed(
      [
        { prompt: 0, mentioned: true },
        { prompt: 1, mentioned: false },
      ],
      PROJECT,
    );

    const all = await load();
    expect(all.options.intents).toEqual(["comparison", "unknown"]);
    const comparison = await load({ intents: ["comparison"] });
    expect(comparison.target?.mention).toMatchObject({
      numerator: 0,
      denominator: 1,
    });
    const unknown = await load({ intents: ["unknown"] });
    expect(unknown.target?.mention).toMatchObject({
      numerator: 1,
      denominator: 1,
    });
    const page = await evidence({ intents: ["comparison"] });
    expect(page.prompts).toMatchObject([
      { promptId: promptIds[1], intent: "comparison" },
    ]);
  });

  it("compares with the previous period only when it measured the same engines", async () => {
    await seed([{ prompt: 0, mentioned: true }], PROJECT);
    await seed([{ prompt: 0 }], { ...PROJECT, createdAt: daysAgo(40) });

    const same = await load();
    expect(same.comparison.comparable).toBe(true);
    expect(same.target?.change).toMatchObject({
      previousVisibility: 0,
      difference: 1,
      verdict: "insufficient_runs",
    });

    await seed([{ prompt: 0, engine: "gemini" }], {
      ...PROJECT,
      createdAt: daysAgo(41),
    });
    const changed = await load();
    expect(changed.comparison.comparable).toBe(false);
    expect(changed.target?.change).toBeNull();
  });
});

describe("loadAiEvidencePage", () => {
  it("pages prompts in a stable order with per-engine counts from this project's runs only", async () => {
    await seed(
      [
        { prompt: 0, mentioned: true, cited: true },
        { prompt: 0, engine: "gemini" },
        { prompt: 1, mentioned: true, recommended: true },
      ],
      PROJECT,
    );
    await seed(
      [{ prompt: 0 }, { prompt: 1, engine: "gemini", status: "failed" }],
      PROJECT,
    );
    await seed([{ prompt: 0, mentioned: true }], { project: "other" });

    const first = await evidence({ limit: 1 });
    const second = await evidence({ limit: 1, cursor: first.nextCursor });

    // "Best rank tracker?" sorts before "Which SEO tools?".
    expect(first.prompts.map((p) => p.promptId)).toEqual([promptIds[1]]);
    expect(first.prompts[0].engines).toEqual([
      { engine: "chatgpt", answers: 1, mentions: 1, cited: 0, recommended: 1 },
    ]);
    expect(second.nextCursor).toBeNull();
    expect(second.prompts.map((p) => p.promptId)).toEqual([promptIds[0]]);
    expect(second.prompts[0].engines).toEqual([
      { engine: "chatgpt", answers: 2, mentions: 1, cited: 1, recommended: 0 },
      { engine: "gemini", answers: 1, mentions: 0, cited: 0, recommended: 0 },
    ]);
    expect(second.prompts[0].answers).toHaveLength(3);
    expect(second.prompts[0].answers).toContainEqual(
      expect.objectContaining({
        engine: "chatgpt",
        mentioned: true,
        cited: true,
      }),
    );
    expect(second.brandDomain).toBe("caldrin.co");
  });
});
