import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiObservations, projectCompetitors } from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import {
  collectAiLiveBatch,
  collectAiModelBatch,
  collectAiRound,
  collectLateAiAnswers,
  postAiBatch,
  prepareAiRun,
} from "./aiVisibilityCollection";
import { finalizeAiRun } from "./aiVisibilityRunOutcome";
import { configuration, customer } from "./aiVisibilityTestFixtures";

const { testDb, dataforseo, askSearchEngine } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return {
    testDb: await createAiVisibilityTestDb(),
    dataforseo: {
      trackingTaskPost: vi.fn(),
      trackingLiveBatch: vi.fn(),
      fetchTaskResult: vi.fn(),
    },
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
  createDataforseoClient: () => ({
    aiSearch: {
      trackingTaskPost: dataforseo.trackingTaskPost,
      trackingLiveBatch: dataforseo.trackingLiveBatch,
    },
  }),
  fetchAiTrackingTaskResult: dataforseo.fetchTaskResult,
}));
vi.mock("@/server/lib/llm-search", () => ({ askSearchEngine }));

const runId = "run";
const market = { locationCode: 2840, languageCode: "en" };
const pendingTask = {
  tag: "answer-0",
  taskId: "task",
  costUsd: 0.002,
  engine: "chatgpt",
  prompt: "Which SEO tools?",
  attempts: 1,
} as const;
const liveAnswer = {
  status: "fulfilled",
  value: {
    status: "completed",
    result: { markdown: "Caldrin Search", sources: [] },
  },
} as const;
const providerFailure = {
  status: "failed",
  message: "Internal Server Error.",
  code: "UPSTREAM_UNAVAILABLE",
  retryable: true,
} as const;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.db.insert(projectCompetitors).values({
    id: "competitor",
    projectId: "project",
    domain: "ahrefs.com",
    name: "Ahrefs",
    updatedBy: "user",
  });
  const rows = configuration({
    engines: ["chatgpt"],
    prompts: [{ text: "Which SEO tools?" }, { text: "Best rank tracker?" }],
  });
  await repo.saveConfiguration(rows);
  await repo.createRun(
    {
      id: runId,
      trackerId: rows.tracker.id,
      projectId: "project",
      trigger: "manual",
      status: "running",
      ...market,
      createdAt: "2026-09-05T12:00:00.000Z",
    },
    rows.prompts.map((prompt, index) => ({
      id: `answer-${index}`,
      runId,
      promptId: prompt.id,
      engine: "chatgpt",
      branded: false,
    })),
  );
});

describe("AI answer collection", () => {
  it("saves an answer with its citations and each brand's mention and citation", async () => {
    dataforseo.fetchTaskResult.mockResolvedValue({
      status: "completed",
      result: {
        markdown:
          "Try **Ahrefs** or Caldrin Search [1](https://caldrin.co/pricing?utm_source=chatgpt)",
        sources: [
          {
            url: "https://caldrin.co/pricing?utm_source=chatgpt",
            title: "Pricing",
          },
        ],
      },
    });

    const round = await collectAiRound(runId, [pendingTask], true);

    expect(round).toEqual({ pending: [], retry: [] });
    expect(await repo.getObservation("answer-0")).toMatchObject({
      status: "completed",
    });
    const evidence = await repo.getEvidence(["answer-0"]);
    expect(evidence.sources).toMatchObject([
      { url: "https://caldrin.co/pricing", domain: "caldrin.co", position: 1 },
    ]);
    expect(evidence.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "caldrin.co",
          own: true,
          mentioned: true,
          cited: true,
          firstMention: 14,
        }),
        expect.objectContaining({
          domain: "ahrefs.com",
          own: false,
          mentioned: true,
          cited: false,
          firstMention: 4,
        }),
      ]),
    );
    // A retried step skips the answer an earlier attempt already saved.
    await collectAiRound(runId, [pendingTask], true);
    expect(dataforseo.fetchTaskResult).toHaveBeenCalledTimes(1);
  });

  it("fails the answers DataForSEO did not accept and collects the rest", async () => {
    dataforseo.trackingTaskPost.mockResolvedValue([
      { tag: "answer-0", taskId: "task", costUsd: 0.002 },
    ]);

    const pending = await postAiBatch(runId, customer, market, {
      engine: "chatgpt",
      tasks: [
        { tag: "answer-0", prompt: "Which SEO tools?" },
        { tag: "answer-1", prompt: "Best rank tracker?" },
      ],
    });

    expect(pending).toEqual([pendingTask]);
    expect(await repo.getObservation("answer-1")).toMatchObject({
      status: "failed",
    });
  });

  it("counts the attempt of an answer posted again, so its retries stop at 3", async () => {
    dataforseo.trackingTaskPost.mockResolvedValue([
      { tag: "answer-0", taskId: "task", costUsd: 0.002 },
    ]);

    const pending = await postAiBatch(runId, customer, market, {
      engine: "chatgpt",
      tasks: [{ tag: "answer-0", prompt: "Which SEO tools?", attempts: 2 }],
    });

    expect(pending).toEqual([{ ...pendingTask, attempts: 3 }]);
  });

  it("returns a queued answer DataForSEO's backend failed for a new post, and fails it after the last attempt", async () => {
    dataforseo.fetchTaskResult.mockResolvedValue(providerFailure);

    const round = await collectAiRound(
      runId,
      [
        pendingTask,
        {
          ...pendingTask,
          tag: "answer-1",
          prompt: "Best rank tracker?",
          attempts: 3,
        },
      ],
      true,
    );

    expect(round.retry).toEqual([
      {
        engine: "chatgpt",
        tasks: [{ tag: "answer-0", prompt: "Which SEO tools?", attempts: 1 }],
      },
    ]);
    expect(await repo.getObservation("answer-1")).toMatchObject({
      status: "failed",
      error: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("saves each model answer without waiting for slower calls", async () => {
    askSearchEngine.mockImplementation(
      (_customer: unknown, _engine: string, { prompt }: { prompt: string }) =>
        prompt === "Best rank tracker?"
          ? new Promise(() => {})
          : Promise.resolve({
              text: "An answer.",
              citations: [],
              queries: null,
              model: null,
              outputTokens: null,
            }),
    );

    void collectAiModelBatch(runId, customer, market, {
      engine: "claude",
      tasks: [
        { tag: "answer-0", prompt: "Which SEO tools?" },
        { tag: "answer-1", prompt: "Best rank tracker?" },
      ],
    });

    await vi.waitFor(async () =>
      expect(await repo.getObservation("answer-0")).toMatchObject({
        status: "completed",
      }),
    );
    expect(await repo.getObservation("answer-1")).toMatchObject({
      status: "pending",
    });
  });

  it("saves model answers with their cited pages and fails the calls that error", async () => {
    askSearchEngine.mockImplementation(
      async (
        _customer: unknown,
        _engine: string,
        { prompt }: { prompt: string },
      ) => {
        if (prompt === "Best rank tracker?") throw new Error("Timed out");
        return {
          text: "Try Caldrin Search.",
          citations: [{ url: "https://caldrin.co/", title: "Caldrin Search" }],
          queries: ["best seo tool"],
          model: "claude-sonnet-5-5",
          outputTokens: 12,
        };
      },
    );

    await collectAiModelBatch(runId, customer, market, {
      engine: "claude",
      tasks: [
        { tag: "answer-0", prompt: "Which SEO tools?" },
        { tag: "answer-1", prompt: "Best rank tracker?" },
      ],
    });

    expect(askSearchEngine).toHaveBeenCalledWith(
      customer,
      "claude",
      expect.objectContaining({ webSearch: true, country: "US" }),
    );
    expect(await repo.getObservation("answer-0")).toMatchObject({
      status: "completed",
      answerMarkdown: "Try Caldrin Search.",
    });
    expect((await repo.getEvidence(["answer-0"])).sources).toMatchObject([
      { url: "https://caldrin.co/", domain: "caldrin.co" },
    ]);
    expect(await repo.getObservation("answer-1")).toMatchObject({
      status: "failed",
      error: "INTERNAL_ERROR",
    });
  });

  it("asks a model answer again when the provider is unavailable, up to three attempts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    askSearchEngine.mockImplementation(
      async (
        _customer: unknown,
        _engine: string,
        { prompt }: { prompt: string },
      ) => {
        if (prompt === "Best rank tracker?")
          throw new AppError("VALIDATION_ERROR", "Anthropic rejected the key.");
        throw new AppError("UPSTREAM_UNAVAILABLE", "Anthropic is unavailable.");
      },
    );

    const collecting = collectAiModelBatch(runId, customer, market, {
      engine: "claude",
      tasks: [
        { tag: "answer-0", prompt: "Which SEO tools?" },
        { tag: "answer-1", prompt: "Best rank tracker?" },
      ],
    });
    await vi.runAllTimersAsync();
    await collecting;

    expect(askSearchEngine).toHaveBeenCalledTimes(4);
    expect(await repo.getObservation("answer-0")).toMatchObject({
      status: "failed",
      error: "UPSTREAM_UNAVAILABLE",
    });
    expect(await repo.getObservation("answer-1")).toMatchObject({
      status: "failed",
      error: "VALIDATION_ERROR",
    });
  });

  it("sends Claude to the model API, not the live scraper, on a manual run", async () => {
    const [{ promptId }] = await repo.getObservations([runId]);
    await testDb.db.insert(aiObservations).values({
      id: "answer-claude",
      runId,
      promptId,
      engine: "claude",
      branded: false,
    });

    const plan = await prepareAiRun(runId);

    expect(plan.modelBatches).toMatchObject([
      { engine: "claude", tasks: [{ tag: "answer-claude" }] },
    ]);
    expect(plan.batches.flat()).not.toContainEqual(
      expect.objectContaining({ engine: "claude" }),
    );
  });

  it("collects a manual run live, saving answers and failing rejected calls", async () => {
    expect(await prepareAiRun(runId)).toMatchObject({ live: true });
    dataforseo.trackingLiveBatch.mockResolvedValue([
      liveAnswer,
      { status: "rejected", reason: new Error("Timed out") },
    ]);

    await collectAiLiveBatch(runId, customer, market, [
      { tag: "answer-0", prompt: "Which SEO tools?", engine: "chatgpt" },
      { tag: "answer-1", prompt: "Best rank tracker?", engine: "chatgpt" },
    ]);

    expect(await repo.getObservation("answer-0")).toMatchObject({
      status: "completed",
    });
    expect(await repo.getObservation("answer-1")).toMatchObject({
      status: "failed",
      error: "INTERNAL_ERROR",
    });
    expect(dataforseo.trackingLiveBatch).toHaveBeenCalledOnce();
  });

  it("asks a live answer again when DataForSEO's backend fails it, up to 3 attempts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const failed = { status: "fulfilled", value: providerFailure };
    dataforseo.trackingLiveBatch
      .mockResolvedValueOnce([failed, failed])
      .mockResolvedValueOnce([liveAnswer, failed])
      .mockResolvedValueOnce([failed]);

    const collecting = collectAiLiveBatch(runId, customer, market, [
      { tag: "answer-0", prompt: "Which SEO tools?", engine: "chatgpt" },
      { tag: "answer-1", prompt: "Best rank tracker?", engine: "chatgpt" },
    ]);
    await vi.runAllTimersAsync();
    await collecting;

    expect(dataforseo.trackingLiveBatch).toHaveBeenCalledTimes(3);
    expect(await repo.getObservation("answer-0")).toMatchObject({
      status: "completed",
    });
    expect(await repo.getObservation("answer-1")).toMatchObject({
      status: "failed",
      error: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("saves the rest of a paid live batch when one answer cannot be saved", async () => {
    dataforseo.trackingLiveBatch.mockResolvedValue([liveAnswer, liveAnswer]);
    vi.spyOn(repo, "persistAnswer").mockRejectedValueOnce(new Error("D1"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await collectAiLiveBatch(runId, customer, market, [
      { tag: "answer-0", prompt: "Which SEO tools?", engine: "chatgpt" },
      { tag: "answer-1", prompt: "Best rank tracker?", engine: "chatgpt" },
    ]);

    expect(await repo.getObservation("answer-0")).toMatchObject({
      status: "pending",
    });
    expect(await repo.getObservation("answer-1")).toMatchObject({
      status: "completed",
    });
  });

  it("fills in an answer that arrives after the run finished, and clears the notice", async () => {
    dataforseo.fetchTaskResult.mockResolvedValue(liveAnswer.value);
    await collectAiRound(runId, [pendingTask], true);
    await finalizeAiRun(runId);

    const late = { ...pendingTask, tag: "answer-1" };
    expect(await collectLateAiAnswers(runId, [late])).toEqual([]);

    expect(await repo.getObservation("answer-1")).toMatchObject({
      status: "completed",
      error: null,
    });
    expect(await repo.getRunInternal(runId)).toMatchObject({
      status: "completed",
    });
    expect((await repo.getTracker("project"))?.lastSkipReason).toBeNull();
  });
});
