import type { Channel } from "./vocabulary";

const RULES: { pattern: RegExp; channel: Channel; source: string }[] = [
  { pattern: /chat\s?gpt|openai/i, channel: "ai_referral", source: "ChatGPT" },
  { pattern: /perplexity/i, channel: "ai_referral", source: "Perplexity" },
  { pattern: /gemini|bard/i, channel: "ai_referral", source: "Gemini" },
  { pattern: /claude|anthropic/i, channel: "ai_referral", source: "Claude" },
  { pattern: /copilot/i, channel: "ai_referral", source: "Copilot" },
  { pattern: /\bai\b|llm/i, channel: "ai_referral", source: "An AI assistant" },
  { pattern: /linkedin/i, channel: "social", source: "LinkedIn" },
  {
    pattern: /facebook|instagram|meta ads?/i,
    channel: "social",
    source: "Meta",
  },
  { pattern: /tiktok/i, channel: "social", source: "TikTok" },
  { pattern: /youtube/i, channel: "social", source: "YouTube" },
  { pattern: /reddit/i, channel: "social", source: "Reddit" },
  { pattern: /\bx\b|twitter/i, channel: "social", source: "X" },
  {
    pattern: /friend|colleague|word of mouth|recommend|referr|told me/i,
    channel: "referral",
    source: "Word of mouth",
  },
  { pattern: /newsletter|e-?mail/i, channel: "email", source: "Email" },
  // Said "Google" or "search": organic, paid, maps and AI answers all fit.
  {
    pattern: /google|search|bing/i,
    channel: "search_unspecified",
    source: "Google or search",
  },
];

/**
 * Reads a buyer's own words for how they found you. It maps only what the
 * words name. Anything else is kept as unknown with the original text, and
 * "Google" is never read as organic search.
 */
export function classifySelfReported(text: string): {
  channel: Channel;
  source: string | null;
} {
  for (const rule of RULES)
    if (rule.pattern.test(text))
      return { channel: rule.channel, source: rule.source };
  return { channel: "unknown", source: null };
}
