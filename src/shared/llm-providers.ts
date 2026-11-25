// The AI providers a bring-your-own-key workspace can choose. Every one but
// Anthropic and OpenRouter is reached through its OpenAI-compatible endpoint.
export const LLM_PROVIDERS = [
  "anthropic",
  "openai",
  "openrouter",
  "groq",
  "vercel",
  "cloudflare",
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

type LlmProviderInfo = {
  label: string;
  // Chat turns and short tasks, and the heavier research work.
  fastModel: string;
  smartModel: string;
  // Cloudflare's endpoint is per account.
  needsAccountId?: boolean;
  keyHelp: string;
};

export const LLM_PROVIDER_INFO: Record<LlmProvider, LlmProviderInfo> = {
  anthropic: {
    label: "Anthropic",
    fastModel: "claude-haiku-5-5",
    smartModel: "claude-sonnet-5-5",
    keyHelp: "console.anthropic.com → API keys",
  },
  openai: {
    label: "OpenAI",
    fastModel: "gpt-4.1-mini",
    smartModel: "gpt-4.1",
    keyHelp: "platform.openai.com → API keys",
  },
  openrouter: {
    label: "OpenRouter",
    fastModel: "openai/gpt-4.1-mini",
    smartModel: "openai/gpt-4.1",
    keyHelp: "openrouter.ai → Keys",
  },
  groq: {
    label: "Groq",
    fastModel: "llama-3.3-70b-versatile",
    smartModel: "llama-3.3-70b-versatile",
    keyHelp: "console.groq.com → API keys",
  },
  vercel: {
    label: "Vercel AI Gateway",
    fastModel: "openai/gpt-4.1-mini",
    smartModel: "openai/gpt-4.1",
    keyHelp: "Vercel dashboard → AI Gateway → API keys",
  },
  cloudflare: {
    label: "Cloudflare Workers AI",
    fastModel: "@cf/qwen/qwen3-30b-a3b-fp8",
    smartModel: "@cf/qwen/qwen3-30b-a3b-fp8",
    needsAccountId: true,
    keyHelp:
      "Cloudflare API token with Workers AI access, plus your account id",
  },
};

export function isLlmProvider(value: string): value is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(value);
}

// OpenAI-compatible base URLs. Anthropic and OpenRouter have their own SDKs.
export function llmBaseUrl(
  provider: LlmProvider,
  accountId?: string | null,
): string | null {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "vercel":
      return "https://ai-gateway.vercel.sh/v1";
    case "cloudflare":
      return accountId
        ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
        : null;
    default:
      return null;
  }
}
