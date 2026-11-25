import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { AiObservationProductRepository } from "@/server/features/ai-visibility/repositories/aiObservationProductRepository";
import { ensurePromptSetVersion } from "./aiPromptSetVersions";
import { configuration } from "./aiVisibilityTestFixtures";
import { seedMeasurementRun } from "./aiMeasurementTestSeed";
import { getObservedProducts } from "./aiObservedProducts";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

const card = (observationId: string, title: string, position: number) => ({
  id: `${observationId}-${position}`,
  observationId,
  position,
  title,
  price: 100 + position,
  currency: "USD",
  tag: position === 1 ? "Best overall" : null,
  providerField: "chat_gpt_products_element",
});

beforeEach(async () => {
  await testDb.seedProject();
  const rows = configuration({
    engines: ["chatgpt", "gemini"],
    prompts: [
      { text: "Best running shoes?" },
      { text: "Shoes for flat feet?" },
    ],
  });
  await repo.saveConfiguration(rows);
  const promptIds = rows.prompts.map((p) => p.id);
  const versionId = await ensurePromptSetVersion(rows.tracker.id, promptIds);
  await seedMeasurementRun(
    testDb.db,
    { trackerId: rows.tracker.id, promptIds, versionId },
    [
      { prompt: 0, engine: "chatgpt" },
      { prompt: 1, engine: "chatgpt" },
      { prompt: 0, engine: "gemini" },
    ],
    { createdAt: new Date(Date.now() - 86_400_000).toISOString() },
  );
});

describe("observed products", () => {
  it("groups cards by title across answers and counts only answers that showed cards", async () => {
    const [first, second] = (
      await testDb.client.execute(
        "SELECT id FROM ai_observations WHERE engine = 'chatgpt' ORDER BY id",
      )
    ).rows.map((r) => z.string().parse(r.id));
    await AiObservationProductRepository.replaceForObservation(first, [
      card(first, "Brooks Adrenaline GTS 25", 1),
      card(first, "Hoka Clifton 10", 2),
    ]);
    await AiObservationProductRepository.replaceForObservation(second, [
      card(second, "brooks adrenaline gts 25!", 2),
    ]);

    const result = await getObservedProducts({
      projectId: "project",
      days: 28,
    });

    expect(result.coverage).toMatchObject({
      answered: 3,
      answeredWithProducts: 2,
    });
    expect(result.products[0]).toMatchObject({
      name: expect.stringMatching(/brooks/i) as unknown,
      answers: 2,
      averagePosition: 1.5,
      prices: [{ currency: "USD", min: 101, max: 102 }],
      tags: ["Best overall"],
    });
    expect(result.products[1]).toMatchObject({
      name: "Hoka Clifton 10",
      answers: 1,
    });
    expect(
      result.coverage.engines.find((e) => e.engine === "gemini"),
    ).toMatchObject({ answered: 1, withProducts: 0 });
  });
});
