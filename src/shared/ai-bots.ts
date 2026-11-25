/**
 * AI crawlers a site owner can allow or block in robots.txt. The role says
 * what the operator documents the bot is for, which decides how a block
 * reads: blocking a search bot keeps the site out of that assistant's
 * answers, blocking a training bot only opts out of model training.
 */
export type AiBotRole = "search" | "user" | "training";

export const AI_BOTS: readonly {
  token: string;
  operator: string;
  role: AiBotRole;
}[] = [
  { token: "OAI-SearchBot", operator: "OpenAI", role: "search" },
  { token: "ChatGPT-User", operator: "OpenAI", role: "user" },
  { token: "GPTBot", operator: "OpenAI", role: "training" },
  { token: "Claude-SearchBot", operator: "Anthropic", role: "search" },
  { token: "Claude-User", operator: "Anthropic", role: "user" },
  { token: "ClaudeBot", operator: "Anthropic", role: "training" },
  { token: "PerplexityBot", operator: "Perplexity", role: "search" },
  { token: "Perplexity-User", operator: "Perplexity", role: "user" },
  { token: "Googlebot", operator: "Google", role: "search" },
  { token: "Google-Extended", operator: "Google", role: "training" },
  { token: "Applebot", operator: "Apple", role: "search" },
  { token: "Applebot-Extended", operator: "Apple", role: "training" },
  { token: "Amazonbot", operator: "Amazon", role: "search" },
  { token: "CCBot", operator: "Common Crawl", role: "training" },
];

// Robots.txt tokens that never appear in a request's user agent: the operator
// fetches with its ordinary crawler and only honors the token. Googlebot is
// left out because it is Google's search crawler, not an AI-specific one.
const NOT_IN_USER_AGENT = new Set([
  "Googlebot",
  "Google-Extended",
  "Applebot-Extended",
]);

const OBSERVABLE_BOTS = AI_BOTS.filter(
  (bot) => !NOT_IN_USER_AGENT.has(bot.token),
);

/**
 * The AI crawler a request's user agent claims to be, or null. A claim only:
 * anyone can send any user agent, and this does not check the operator's IP
 * ranges.
 */
export function detectAiBot(userAgent: string): string | null {
  const agent = userAgent.toLowerCase();
  return (
    OBSERVABLE_BOTS.find((bot) => agent.includes(bot.token.toLowerCase()))
      ?.token ?? null
  );
}

/** User-agent tokens a Worker snippet can match; see {@link detectAiBot}. */
export const AI_BOT_USER_AGENT_TOKENS = OBSERVABLE_BOTS.map((bot) => bot.token);
