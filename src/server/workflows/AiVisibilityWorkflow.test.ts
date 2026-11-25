import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import { AiVisibilityWorkflow } from "./AiVisibilityWorkflow";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  post: vi.fn(),
  live: vi.fn(),
  model: vi.fn(),
  collect: vi.fn(),
  late: vi.fn(),
  finalize: vi.fn(),
  markFailed: vi.fn(),
  reservation: vi.fn(),
  settle: vi.fn(),
  sleep: vi.fn(),
  sleepUntil: vi.fn(),
  steps: vi.fn(),
}));
vi.mock("@/server/features/billing/wallet", () => ({
  walletRunReservation: mocks.reservation,
}));
vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: vi.fn() }));
vi.mock("@/server/features/ai-visibility/services/aiResearchKeywords", () => ({
  runAiResearchSetup: vi.fn(),
}));
vi.mock(
  "@/server/features/ai-visibility/services/aiVisibilityCollection",
  () => ({
    prepareAiRun: mocks.prepare,
    postAiBatch: mocks.post,
    collectAiLiveBatch: mocks.live,
    collectAiModelBatch: mocks.model,
    collectAiRound: mocks.collect,
    collectLateAiAnswers: mocks.late,
  }),
);
vi.mock(
  "@/server/features/ai-visibility/services/aiVisibilityRunOutcome",
  () => ({
    finalizeAiRun: mocks.finalize,
    markAiRunFailed: mocks.markFailed,
    settleWalletAnswers: mocks.settle,
  }),
);
vi.mock("./pgStep", () => ({
  pgStep: (
    _step: unknown,
    name: string,
    config: unknown,
    fn: () => Promise<unknown>,
  ) => {
    mocks.steps(name, config);
    return fn();
  },
}));

const customer = {
  organizationId: "organization",
  userId: "user",
  userEmail: "user@example.com",
};
const task = { tag: "answer", taskId: "task", engine: "chatgpt" };
function execute(walletFunded?: true) {
  // The mocked base and pgStep use no execution context, bindings, or step methods besides the sleeps.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal test runtime boundary
  const workflow = new AiVisibilityWorkflow({} as ExecutionContext, {} as Env);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pgStep is mocked; only the sleeps execute
  const step = {
    sleep: mocks.sleep,
    sleepUntil: mocks.sleepUntil,
  } as unknown as WorkflowStep;
  return workflow.run(
    {
      payload: { runId: "run", customer, walletFunded },
      instanceId: "run",
      // Started a minute ago, so the 46th half-hour read never lands on the cutoff.
      timestamp: new Date(Date.now() - 60_000),
    },
    step,
  );
}
beforeEach(() => {
  mocks.prepare.mockResolvedValue({
    market: { locationCode: 2840, languageCode: "en" },
    modelBatches: [],
    live: false,
    batches: [
      { engine: "chatgpt", tasks: [] },
      { engine: "gemini", tasks: [] },
    ],
  });
  mocks.post.mockResolvedValue([task]);
  mocks.collect.mockResolvedValue({ pending: [], retry: [] });
  mocks.late.mockResolvedValue([]);
});

describe("AI visibility workflow", () => {
  it("settles wallet reservations after late answers and disables paid retries", async () => {
    mocks.reservation.mockResolvedValue({
      organizationId: customer.organizationId,
      charged: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await execute(true);
    expect(mocks.collect).toHaveBeenCalledExactlyOnceWith(
      "run",
      [task, task],
      false,
    );
    expect(mocks.settle).toHaveBeenCalledExactlyOnceWith("run");
  });

  it("posts each batch in a step that never retries, then collects and finalizes", async () => {
    await execute();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.steps).toHaveBeenCalledWith("post-1", {
      retries: { limit: 0, delay: "1 second" },
      timeout: "2 minutes",
    });
    expect(mocks.collect).toHaveBeenCalledExactlyOnceWith(
      "run",
      [task, task],
      true,
    );
    expect(mocks.sleep).toHaveBeenCalledOnce();
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith("run");
  });

  it("asks the model API for Claude and Perplexity, then reads queued answers before sleeping", async () => {
    mocks.prepare.mockResolvedValue({
      market: { locationCode: 2840, languageCode: "en" },
      modelBatches: [{ engine: "claude", tasks: [] }],
      live: false,
      batches: [{ engine: "chatgpt", tasks: [] }],
    });
    await execute();
    expect(mocks.model).toHaveBeenCalledOnce();
    expect(mocks.steps).toHaveBeenCalledWith("read-model-0", {
      retries: { limit: 2, delay: "10 seconds" },
      timeout: "5 minutes",
    });
    expect(mocks.sleep).not.toHaveBeenCalled();
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith("run");
  });

  it("collects a manual run's live batches without posting or polling", async () => {
    mocks.prepare.mockResolvedValue({
      market: { locationCode: 2840, languageCode: "en" },
      modelBatches: [],
      live: true,
      batches: [[]],
    });
    await execute();
    expect(mocks.live).toHaveBeenCalledOnce();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.sleep).not.toHaveBeenCalled();
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith("run");
  });

  it("finishes the run when the collection window closes, then reads missing answers late", async () => {
    mocks.collect.mockResolvedValue({ pending: [task], retry: [] });
    await execute();
    expect(mocks.sleep).toHaveBeenCalledTimes(9);
    expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(mocks.late).toHaveBeenCalledExactlyOnceWith("run", [task]);
    expect(mocks.finalize.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.late.mock.invocationCallOrder[0],
    );
  });

  it("stops reading late answers after 23 hours", async () => {
    mocks.collect.mockResolvedValue({ pending: [task], retry: [] });
    mocks.late.mockResolvedValue([task]);
    await execute();
    // Every 30 minutes for 23 hours.
    expect(mocks.late).toHaveBeenCalledTimes(45);
  });

  it("posts failed answers again in a step that never retries, but not after the last round", async () => {
    const batch = { engine: "chatgpt", tasks: [{ tag: "answer", prompt: "" }] };
    mocks.collect.mockResolvedValue({ pending: [task], retry: [batch] });
    await execute();
    expect(mocks.post).toHaveBeenCalledWith(
      "run",
      customer,
      expect.anything(),
      batch,
    );
    expect(mocks.steps).toHaveBeenCalledWith("repost-0-0", {
      retries: { limit: 0, delay: "1 second" },
      timeout: "2 minutes",
    });
    expect(mocks.collect).toHaveBeenLastCalledWith(
      "run",
      expect.anything(),
      false,
    );
  });

  it("keeps collecting when a live batch's step fails, and finalizes what arrived", async () => {
    mocks.prepare.mockResolvedValue({
      market: { locationCode: 2840, languageCode: "en" },
      modelBatches: [],
      live: true,
      batches: [[], []],
    });
    mocks.live.mockRejectedValueOnce(new Error("internal workflows error"));
    await execute();
    expect(mocks.live).toHaveBeenCalledTimes(2);
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith("run");
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("gives the free bookkeeping steps retries", async () => {
    await execute();
    for (const name of ["prepare", "finalize"])
      expect(mocks.steps).toHaveBeenCalledWith(name, {
        retries: { limit: 2, delay: "10 seconds" },
        timeout: "2 minutes",
      });
  });

  it("fails the run when preparation fails", async () => {
    const error = new Error();
    mocks.prepare.mockRejectedValue(error);
    await expect(execute()).rejects.toThrow(error);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.markFailed).toHaveBeenCalledExactlyOnceWith("run");
    expect(mocks.steps).toHaveBeenCalledWith("mark-failed", {
      retries: { limit: 2, delay: "10 seconds" },
      timeout: "2 minutes",
    });
  });

  it("does not log a rejected poll sleep as a failure, but still marks the run failed", async () => {
    const error = new Error();
    mocks.sleep.mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, "error");
    await expect(execute()).rejects.toThrow(error);
    expect(consoleError).not.toHaveBeenCalled();
    expect(mocks.markFailed).toHaveBeenCalledExactlyOnceWith("run");
  });
});
