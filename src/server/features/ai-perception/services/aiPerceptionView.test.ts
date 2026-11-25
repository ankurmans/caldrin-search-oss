import { sort } from "remeda";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiIntelligenceSchema } from "@/types/schemas/ai-visibility-intelligence";
import { AiVisibilityRepository as repo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { ensurePromptSetVersion } from "@/server/features/ai-visibility/services/aiPromptSetVersions";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { seedMeasurementRun } from "@/server/features/ai-visibility/services/aiMeasurementTestSeed";
import { aiPerceptions } from "@/db/schema";
import { loadPerceptionCell, loadPerceptionView } from "./aiPerceptionView";
import { loadPerceptionExport } from "./perceptionExport";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

const PROJECT = "00000000-0000-4000-8000-000000000001";
const input = aiIntelligenceSchema.parse({ projectId: PROJECT });
let runId: string;
let context: Parameters<typeof seedMeasurementRun>[1];

const reading = (
  observationId: string,
  domain: string,
  over: Partial<typeof aiPerceptions.$inferInsert> = {},
) => ({
  id: `${observationId}-${domain}`,
  observationId,
  domain,
  name: domain,
  own: domain === "caldrin.co",
  stance: "described" as const,
  sentiment: "neutral" as const,
  confidence: "high" as const,
  evidence: null,
  ambiguousName: false,
  classifierVersion: "perception-1",
  model: "small-model",
  classifiedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.client.executeMultiple(
    `UPDATE projects SET id = '${PROJECT}' WHERE id = 'project';`,
  );
  const rows = configuration(
    {
      engines: ["chatgpt", "gemini"],
      prompts: [{ text: "Best rank tracker?" }, { text: "Which SEO tools?" }],
    },
    PROJECT,
  );
  await repo.saveConfiguration(rows);
  const promptIds = rows.prompts.map((p) => p.id);
  const versionId = await ensurePromptSetVersion(rows.tracker.id, promptIds);
  context = { trackerId: rows.tracker.id, promptIds, versionId };
  runId = await seedMeasurementRun(
    testDb.db,
    context,
    [
      { prompt: 0, mentioned: true, text: "Caldrin Search is the pick." },
      { prompt: 0, engine: "gemini", mentioned: true, text: "Caldrin Search." },
      {
        prompt: 1,
        mentioned: false,
        rivalMentioned: true,
        text: "Rival wins.",
      },
      // No answer text: neither a mention nor a missing-neutral reading.
      { prompt: 1, engine: "gemini", status: "failed" },
    ],
    {
      project: PROJECT,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
  );
  const [first] = await repo.getObservations([runId]);
  await testDb.db.insert(aiPerceptions).values([
    reading(first.id, "caldrin.co", {
      stance: "recommended",
      sentiment: "positive",
    }),
  ]);
});

describe("loadPerceptionView", () => {
  it("counts recommended, unread and missing separately, with denominators", async () => {
    const view = await loadPerceptionView(input);
    const own = view.brands.find((b) => b.own);
    expect(own).toMatchObject({
      mention: { numerator: 2, denominator: 3 },
      read: 1,
      unread: 1,
      recommendedOfMentions: { numerator: 1, denominator: 1 },
      recommendedOfAnswers: { numerator: 1, denominator: 3 },
    });
    expect(view.population).toMatchObject({
      planned: 4,
      answered: 3,
      missing: 1,
    });
    expect(view.unread.answers).toBe(2);
    const first = view.heatmap.find((r) => r.prompt === "Best rank tracker?");
    expect(
      first?.cells.find((c) => c.domain === "caldrin.co")?.counts,
    ).toMatchObject({
      recommended: 1,
      unread: 1,
      missing: 0,
    });
    expect(view.comparison.comparable).toBe(false);
  });

  it.each([
    { market: 2840, expected: { previous: { counts: { negative: 2 } } } },
    {
      market: 2826,
      expected: {
        previous: null,
        reason:
          "The two periods sampled different mixes of prompts, engines or markets.",
      },
    },
  ])(
    "compares read sentiment only for matching answer mixes ($market)",
    async ({ market, expected }) => {
      for (const [day, locationCode, sentiment] of [
        [2, 2840, "positive"],
        [29, market, "negative"],
        [30, market, "negative"],
      ] as const) {
        const id = await seedMeasurementRun(
          testDb.db,
          context,
          [{ prompt: 0, mentioned: true }, { prompt: 1 }],
          {
            project: PROJECT,
            locationCode,
            createdAt: new Date(Date.now() - day * 86_400_000).toISOString(),
          },
        );
        const [named] = (await repo.getObservations([id])).filter(
          (row) => row.promptId === context.promptIds[0],
        );
        await testDb.db
          .insert(aiPerceptions)
          .values(reading(named.id, "caldrin.co", { sentiment }));
      }

      const view = await loadPerceptionView({ ...input, engines: ["chatgpt"] });
      expect(view.sentimentComparison).toMatchObject(expected);
      expect(view.brands.find((b) => b.own)?.sentiment.positive).toBe(2);
    },
  );

  it("opens the answers and readings behind a cell", async () => {
    const view = await loadPerceptionView(input);
    const promptId = view.heatmap[0].promptId;
    const cell = await loadPerceptionCell({
      ...input,
      domain: "caldrin.co",
      promptId,
    });
    expect(
      sort(
        cell.answers.map((a) => a.outcome),
        (a, b) => a.localeCompare(b),
      ),
    ).toEqual(["recommended", "unread"]);
    expect(cell.answers.find((a) => a.reading)?.reading?.stance).toBe(
      "recommended",
    );
  });
});

describe("loadPerceptionExport", () => {
  it("includes one row per saved answer and preserves corrections and unread mentions", async () => {
    await testDb.db
      .update(aiPerceptions)
      .set({
        reviewedSentiment: "mixed",
        evidence: "Caldrin Search is the pick.",
      })
      .where(eq(aiPerceptions.domain, "caldrin.co"));

    const { rows } = await loadPerceptionExport({
      ...input,
      domain: "caldrin.co",
    });

    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          engine: "chatgpt",
          prompt: "Best rank tracker?",
          status: "Read",
          stance: "recommended",
          sentiment: "mixed",
          evidence: "Caldrin Search is the pick.",
          corrected: true,
          locationCode: 2840,
        }),
        expect.objectContaining({
          engine: "gemini",
          status: "Unread",
          sentiment: null,
        }),
        expect.objectContaining({
          prompt: "Which SEO tools?",
          status: "Not named",
          sentiment: null,
        }),
      ]),
    );
  });

  it("exports only saved answers in the selected engine", async () => {
    const { rows } = await loadPerceptionExport({
      ...input,
      domain: "caldrin.co",
      engines: ["gemini"],
    });

    expect(rows).toMatchObject([{ engine: "gemini", status: "Unread" }]);
  });
});
