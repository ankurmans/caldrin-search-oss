import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { ensurePromptSetVersion } from "@/server/features/ai-visibility/services/aiPromptSetVersions";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { seedMeasurementRun } from "@/server/features/ai-visibility/services/aiMeasurementTestSeed";
import type { CustomerContext } from "@/server/lib/customer-context";
import { aiMatches } from "@/db/schema";
import { AiPerceptionRepository } from "../repositories/AiPerceptionRepository";
import { classifyRunPerception, reviewPerception } from "./aiPerception";
import { readAnswerPerception } from "./perceptionReading";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("./perceptionReading", () => ({ readAnswerPerception: vi.fn() }));
vi.mock("@/server/lib/openrouter", () => ({
  requireOpenRouterAccess: async () => ({ apiKey: "key" }),
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => undefined,
}));
vi.mock("@/server/features/workspace/researchSpend", () => ({
  withResearchAdmission: (_: unknown, run: () => Promise<void>) => run(),
  recordResearchSpend: vi.fn(),
}));

const customer: CustomerContext = {
  organizationId: "organization",
  userId: "user",
  userEmail: "user@example.com",
};
let runId: string;

beforeEach(async () => {
  await testDb.seedProject();
  const rows = configuration({
    engines: ["chatgpt"],
    prompts: [{ text: "Best rank tracker?" }, { text: "Which SEO tools?" }],
  });
  await repo.saveConfiguration(rows);
  const promptIds = rows.prompts.map((p) => p.id);
  const versionId = await ensurePromptSetVersion(rows.tracker.id, promptIds);
  runId = await seedMeasurementRun(
    testDb.db,
    { trackerId: rows.tracker.id, promptIds, versionId },
    [
      {
        prompt: 0,
        mentioned: true,
        rivalMentioned: true,
        text: "Rival is cheaper but Caldrin Search is the better pick.",
      },
      // Cited but never named in the text: it must get no reading.
      { prompt: 1, mentioned: false, cited: true, text: "Try a tracker." },
    ],
  );
  vi.mocked(readAnswerPerception).mockResolvedValue({
    model: "small-model",
    costUsd: 0.002,
    readings: [
      {
        domain: "caldrin.co",
        name: "Caldrin Search",
        own: true,
        stance: "recommended",
        sentiment: "positive",
        confidence: "high",
        evidence: "Caldrin Search is the better pick",
        ambiguousName: false,
        points: [
          {
            kind: "strength",
            text: "Better pick",
            quote: "the better pick",
          },
        ],
        comparisons: [
          {
            competitorDomain: "rival.example",
            competitorName: "Rival",
            outcome: "preferred",
          },
        ],
      },
      {
        domain: "rival.example",
        name: "Rival",
        own: false,
        stance: "described",
        sentiment: "neutral",
        confidence: "medium",
        evidence: null,
        ambiguousName: false,
        points: [],
        comparisons: [],
      },
    ],
  });
});

describe("answer perception", () => {
  it("reads only answers that name a brand, once, and keeps the match sentiment in step", async () => {
    const first = await classifyRunPerception(
      { projectId: "project", runId },
      customer,
    );
    expect(first).toMatchObject({
      answersRead: 1,
      readingsSaved: 2,
      remaining: 0,
    });
    await classifyRunPerception({ projectId: "project", runId }, customer);
    expect(readAnswerPerception).toHaveBeenCalledTimes(1);

    const observations = await repo.getObservations([runId]);
    const saved = await AiPerceptionRepository.listForObservations(
      observations.map((o) => o.id),
    );
    const own = saved.find((p) => p.own);
    expect(own).toMatchObject({
      stance: "recommended",
      classifierVersion: "perception-1",
      model: "small-model",
    });
    expect(own?.points).toHaveLength(1);
    expect(own?.comparisons).toHaveLength(1);
    const matches = await testDb.db.select().from(aiMatches);
    expect(
      matches.find((m) => m.domain === "caldrin.co" && m.sentiment)?.sentiment,
    ).toBe("positive");
  });

  it("keeps the model's reading when a person corrects it, with the history", async () => {
    await classifyRunPerception({ projectId: "project", runId }, customer);
    const observations = await repo.getObservations([runId]);
    const [own] = (
      await AiPerceptionRepository.listForObservations(
        observations.map((o) => o.id),
      )
    ).filter((p) => p.own);

    await reviewPerception(
      {
        projectId: "project",
        perceptionId: own.id,
        stance: "described",
        note: "It lists the product, not an endorsement.",
      },
      "user",
    );
    await expect(
      reviewPerception(
        { projectId: "other", perceptionId: own.id, stance: "discouraged" },
        "user",
      ),
    ).rejects.toThrow();

    const [after] = (
      await AiPerceptionRepository.listForObservations([own.observationId])
    ).filter((p) => p.own);
    expect(after).toMatchObject({
      stance: "recommended",
      reviewedStance: "described",
      reviewedSentiment: "positive",
    });
    expect(await AiPerceptionRepository.listReviews(own.id)).toMatchObject([
      { field: "stance", fromValue: "recommended", toValue: "described" },
    ]);
  });
});
