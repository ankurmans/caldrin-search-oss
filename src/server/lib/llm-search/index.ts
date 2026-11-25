import {
  assertTrialBudget,
  recordTrialSpend,
} from "@/server/features/workspace/trial";
import type { CustomerContext } from "@/server/lib/customer-context";
import { getModelProviderKey } from "@/server/lib/provider-access";
import { askAnthropic } from "./anthropic";
import { askGemini } from "./gemini";
import { askOpenAi } from "./openai";
import { askPerplexity } from "./perplexity";
import { ESTIMATED_ANSWER_USD } from "./pricing";
import type { SearchAnswer, SearchEngine, SearchRequest } from "./types";

export type { SearchAnswer, SearchEngine } from "./types";

const ENGINES = {
  claude: {
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    ask: askAnthropic,
  },
  perplexity: {
    provider: "perplexity",
    model: "sonar-pro",
    ask: askPerplexity,
  },
  chatgpt: { provider: "openai", model: "gpt-5.5", ask: askOpenAi },
  gemini: { provider: "gemini", model: "gemini-3.5-flash", ask: askGemini },
} as const;

/** The model each engine is asked, which is also what an answer records. */
export const searchModelName = (engine: SearchEngine) => ENGINES[engine].model;

/** Asks one engine through its own API, charging a free test run's budget. */
export async function askSearchEngine(
  customer: CustomerContext,
  engine: SearchEngine,
  input: Pick<
    SearchRequest,
    "prompt" | "maxOutputTokens" | "country" | "webSearch"
  >,
): Promise<SearchAnswer> {
  const { provider, model, ask } = ENGINES[engine];
  const apiKey = await getModelProviderKey(provider);
  const estimate = ESTIMATED_ANSWER_USD[engine];
  await assertTrialBudget(customer.organizationId, estimate);
  const answer = await ask({ ...input, apiKey, model });
  await recordTrialSpend(customer.organizationId, estimate);
  return answer;
}
