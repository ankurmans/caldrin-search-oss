import { beforeEach, describe, expect, it, vi } from "vitest";
import { estimateOperation } from "./estimateOperation";

const mocks = vi.hoisted(() => ({
  rankEstimate: vi.fn(),
  aiEstimate: vi.fn(),
}));
vi.mock("@/server/features/rank-tracking/services/RankTrackingService", () => ({
  RankTrackingService: { estimateCost: mocks.rankEstimate },
}));
vi.mock("@/server/features/ai-visibility/services/aiVisibilityCost", () => ({
  estimateCost: mocks.aiEstimate,
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: {} }));

beforeEach(() => {
  mocks.rankEstimate.mockResolvedValue({ costUsd: 0.42 });
  mocks.aiEstimate.mockResolvedValue({
    costUsd: 1.5,
    runNowCostUsd: 2.5,
    observations: 10,
  });
});

describe("estimateOperation", () => {
  it("uses the live price for a run-now AI visibility check and the queued price otherwise", async () => {
    const base = { kind: "ai_visibility_check", projectId: "p" } as const;
    expect(
      (await estimateOperation({ ...base, mode: "live" })).estimatedUsd,
    ).toBe(2.5);
    expect(
      (await estimateOperation({ ...base, mode: "queued" })).estimatedUsd,
    ).toBe(1.5);
  });

  it("turns a failing estimator into an explicit null instead of throwing", async () => {
    mocks.rankEstimate.mockRejectedValue(new Error("config not found"));
    await expect(
      estimateOperation({ kind: "rank_check", projectId: "p", configId: "c" }),
    ).resolves.toMatchObject({ estimatedUsd: null });
  });

  it("gives the LLM draft a constant estimate", async () => {
    const result = await estimateOperation({ kind: "llm_draft" });
    expect(result.estimatedUsd).toBeGreaterThan(0);
  });
});
