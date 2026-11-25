import type { SearchEngine } from "./types";

/**
 * Upper-bound USD for one answer with web search at the 4096-token output cap,
 * from the bills measured for these models. Checked against a free test run's
 * budget and used for cost estimates; the real bill is the provider's own.
 */
export const ESTIMATED_ANSWER_USD: Record<SearchEngine, number> = {
  claude: 0.18,
  perplexity: 0.04,
  chatgpt: 0.09,
  gemini: 0.11,
};
