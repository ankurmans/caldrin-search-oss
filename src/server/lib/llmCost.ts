import type { LanguageModelUsage } from "ai";
import { z } from "zod";

// What a model call cost us, in USD. OpenRouter reports it per response; the
// direct Anthropic API reports only token counts, so those are priced here.
// Models we have no price for (a BYOK workspace's own provider) cost 0: the
// workspace pays its provider, not us.
//
// Anthropic list prices per million tokens. Cache reads bill at 0.1x input and
// cache writes at 1.25x (the 5-minute cache). Haiku 5.5 doubles past 100K
// prompt tokens. Check these against Anthropic's pricing page when the
// default models change.
type Price = { input: number; output: number };
const PRICES: Record<string, { standard: Price; longPrompt?: Price }> = {
  "claude-sonnet-5-5": { standard: { input: 2, output: 10 } },
  "claude-haiku-5-5": {
    standard: { input: 0.1, output: 0.5 },
    longPrompt: { input: 0.5, output: 2.5 },
  },
};
const LONG_PROMPT_TOKENS = 100_000;
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

const openRouterUsageSchema = z.object({
  openrouter: z.object({ usage: z.object({ cost: z.number() }) }),
});

type LlmCallResult = {
  providerMetadata?: unknown;
  usage: LanguageModelUsage;
  response: { modelId: string };
};

export function llmCostUsd(result: LlmCallResult): number {
  const reported = openRouterUsageSchema.safeParse(result.providerMetadata);
  if (reported.success) return reported.data.openrouter.usage.cost;

  const price = PRICES[result.response.modelId];
  if (!price) return 0;
  const { inputTokens, outputTokens, inputTokenDetails } = result.usage;
  const input = inputTokens ?? 0;
  const cacheRead = inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWrite = inputTokenDetails.cacheWriteTokens ?? 0;
  const plain =
    inputTokenDetails.noCacheTokens ?? input - cacheRead - cacheWrite;
  const rate =
    price.longPrompt && input > LONG_PROMPT_TOKENS
      ? price.longPrompt
      : price.standard;
  const inputUsd =
    (plain +
      cacheRead * CACHE_READ_MULTIPLIER +
      cacheWrite * CACHE_WRITE_MULTIPLIER) *
    rate.input;
  // Reasoning tokens are already inside outputTokens.
  return (inputUsd + (outputTokens ?? 0) * rate.output) / 1_000_000;
}
