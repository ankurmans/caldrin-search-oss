import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiIntelligenceSchema } from "@/types/schemas/ai-visibility-intelligence";
import { AiVisibilityRepository as repo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { ensurePromptSetVersion } from "@/server/features/ai-visibility/services/aiPromptSetVersions";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { seedMeasurementRun } from "@/server/features/ai-visibility/services/aiMeasurementTestSeed";
import { aiPerceptionPoints, aiPerceptions } from "@/db/schema";
import { loadPerceptionSources } from "./aiPerceptionSources";
import { groupThemes } from "./perceptionThemes";

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

const reading = (observationId: string, over = {}) => ({
  id: `${observationId}-r`,
  observationId,
  domain: "caldrin.co",
  name: "Caldrin Search",
  own: true,
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
  const runId = await seedMeasurementRun(
    testDb.db,
    { trackerId: rows.tracker.id, promptIds, versionId },
    [
      {
        prompt: 0,
        mentioned: true,
        text: "Caldrin Search is the pick.",
        sources: ["https://reddit.com/r/seo", "https://g2.com/products/x"],
      },
      {
        prompt: 0,
        engine: "gemini",
        mentioned: true,
        text: "Caldrin Search costs a lot.",
        sources: ["https://reddit.com/r/seo"],
      },
      {
        prompt: 1,
        rivalMentioned: true,
        text: "Rival wins.",
        sources: ["https://g2.com/products/x"],
      },
    ],
    {
      project: PROJECT,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
  );
  const [first, second] = await repo.getObservations([runId]);
  await testDb.db
    .insert(aiPerceptions)
    .values([
      reading(first.id, { stance: "recommended", sentiment: "positive" }),
      reading(second.id, { sentiment: "negative" }),
    ]);
  await testDb.db.insert(aiPerceptionPoints).values({
    id: "p1",
    perceptionId: `${second.id}-r`,
    kind: "weakness",
    text: "Costs a lot",
    quote: "costs a lot",
  });
});

describe("loadPerceptionSources", () => {
  it("sets each source's answers against how they treated the brand", async () => {
    const result = await loadPerceptionSources(input);
    const reddit = result.sources.find((s) => s.domain === "reddit.com");
    expect(reddit).toMatchObject({
      answers: 2,
      sourceClass: "community",
      outcomes: { recommended: 1, negative: 1 },
      recommended: { numerator: 1, denominator: 2 },
    });
    const g2 = result.sources.find((s) => s.domain === "g2.com");
    // The answer that never named the brand is counted as missing, not read.
    expect(g2?.outcomes).toMatchObject({ recommended: 1, missing: 1 });
    expect(g2?.recommended).toMatchObject({ numerator: 1, denominator: 1 });
    expect(result.baseline).toMatchObject({ numerator: 1, denominator: 2 });
    expect(result.themes).toMatchObject([
      { kind: "weakness", label: "Costs a lot", answers: { numerator: 1 } },
    ]);
  });
});

const point = (
  observationId: string,
  kind: "weakness" | "objection",
  text: string,
) => ({
  observationId,
  promptId: "p",
  engine: "chatgpt" as const,
  kind,
  text,
  quote: text,
});

describe("groupThemes", () => {
  it("merges close wordings of one kind and keeps kinds apart", () => {
    const themes = groupThemes(
      [
        point("a", "weakness", "Pricing is expensive"),
        point("b", "weakness", "Expensive pricing"),
        point("c", "objection", "Pricing is expensive"),
      ],
      3,
      new Map(),
    );
    expect(themes.map((t) => [t.kind, t.answers.numerator])).toEqual([
      ["weakness", 2],
      ["objection", 1],
    ]);
  });
});
