import { describe, expect, it } from "vitest";
import { llmCostUsd } from "./llmCost";

const usage = (over: Record<string, unknown> = {}) => ({
  inputTokens: 1_000_000,
  outputTokens: 100_000,
  inputTokenDetails: {
    noCacheTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  totalTokens: undefined,
  ...over,
});

describe("llmCostUsd", () => {
  it("prices Anthropic token counts, with cache reads at a tenth", () => {
    const cached = usage({
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 0,
      },
    });
    const response = { modelId: "claude-sonnet-5-5" };
    expect(llmCostUsd({ usage: usage(), response })).toBeCloseTo(3);
    expect(llmCostUsd({ usage: cached, response })).toBeCloseTo(1.2);
  });

  it("takes the cost OpenRouter reported over any token math", () => {
    const providerMetadata = { openrouter: { usage: { cost: 0.42 } } };
    expect(
      llmCostUsd({
        providerMetadata,
        usage: usage(),
        response: { modelId: "claude-sonnet-5-5" },
      }),
    ).toBe(0.42);
  });

  it("counts a model it has no price for as free", () => {
    expect(llmCostUsd({ usage: usage(), response: { modelId: "gpt-9" } })).toBe(
      0,
    );
  });
});
