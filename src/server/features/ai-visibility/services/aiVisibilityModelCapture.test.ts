import { beforeEach, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { collectAiModelBatch, collectAiRound } from "./aiVisibilityCollection";
import { configuration, customer } from "./aiVisibilityTestFixtures";

const { testDb, dataforseo, askSearchEngine } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return {
    testDb: await createAiVisibilityTestDb(),
    dataforseo: { fetchTaskResult: vi.fn() },
    askSearchEngine: vi.fn(),
  };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("cloudflare:workflows", () => ({
  NonRetryableError: class extends Error {},
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/dataforseo", () => ({
  MAX_TASKS_PER_POST: 100,
  fetchAiTrackingTaskResult: dataforseo.fetchTaskResult,
}));
vi.mock("@/server/lib/llm-search", () => ({ askSearchEngine }));

const market = { locationCode: 2840, languageCode: "en" };

beforeEach(async () => {
  await testDb.seedProject();
  const rows = configuration({
    engines: ["chatgpt"],
    prompts: [{ text: "Which SEO tools?" }, { text: "Best rank tracker?" }],
  });
  await repo.saveConfiguration(rows);
  await repo.createRun(
    {
      id: "run",
      trackerId: rows.tracker.id,
      projectId: "project",
      trigger: "manual",
      status: "running",
      ...market,
      createdAt: "2026-09-05T12:00:00.000Z",
    },
    rows.prompts.map((prompt, index) => ({
      id: `answer-${index}`,
      runId: "run",
      promptId: prompt.id,
      engine: "chatgpt",
      branded: false,
    })),
  );
});

it("stores the model a provider reports, null when it reports none, and the extractor of each new match", async () => {
  askSearchEngine.mockResolvedValue({
    text: "Try Caldrin Search.",
    citations: [],
    queries: null,
    model: "claude-sonnet-5-20260101",
    outputTokens: null,
  });
  dataforseo.fetchTaskResult.mockResolvedValue({
    status: "completed",
    result: { markdown: "Try Caldrin Search." },
  });

  await collectAiModelBatch("run", customer, market, {
    engine: "claude",
    tasks: [{ tag: "answer-0", prompt: "Which SEO tools?" }],
  });
  await collectAiRound(
    "run",
    [
      {
        tag: "answer-1",
        taskId: "task",
        costUsd: 0.002,
        engine: "chatgpt",
        prompt: "Best rank tracker?",
        attempts: 1,
      },
    ],
    true,
  );

  expect(await repo.getObservation("answer-0")).toMatchObject({
    model: "claude-sonnet-5-20260101",
  });
  expect(await repo.getObservation("answer-1")).toMatchObject({ model: null });
  const { matches } = await repo.getEvidence(["answer-0", "answer-1"]);
  expect(matches.map((m) => m.extractionVersion)).toEqual([
    "phrase-heuristic-v1",
    "phrase-heuristic-v1",
  ]);
});
