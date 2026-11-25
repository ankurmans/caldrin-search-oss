import { AppError } from "@/server/lib/errors";
import { currentWorkspaceId } from "@/server/lib/workspace-scope";
import {
  LLM_PROVIDER_INFO,
  isLlmProvider,
  llmBaseUrl,
} from "@/shared/llm-providers";
import {
  createOpenRouter,
  type LanguageModelV3,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import { createAnthropic } from "@ai-sdk/anthropic";
import { wrapLanguageModel } from "ai";
import { getEnvValueSync, getWorkersEnv } from "@/server/lib/runtime-env";

/**
 * Which model a task needs. "fast" is the cheap model: chat turns and short
 * extraction. "smart" is the one for drafting and research that must hold up.
 * Each provider maps the two to its own models (see `LLM_PROVIDER_INFO`).
 */
export type ModelTier = "fast" | "smart";

/** How a deployment reaches a language model: the key and endpoint it was configured with. */
export type OpenRouterAccess =
  | { anthropicKey: string; fastModel?: string; smartModel?: string }
  // Any other OpenAI-compatible provider a BYOK workspace chose (OpenAI, Groq,
  // Vercel AI Gateway, Cloudflare Workers AI): plain chat requests, none of
  // OpenRouter's extensions.
  | {
      compatKey: string;
      baseURL: string;
      fastModel: string;
      smartModel: string;
    }
  | {
      apiKey: string;
      baseURL?: string;
      models?: { fast: string; smart: string };
    };

/**
 * This deployment's OpenRouter access, or null without one. Sync for
 * samAccess.
 */
export function getOpenRouterAccess(env: object): OpenRouterAccess | null {
  // Anthropic takes precedence: Sonnet for SAM, Haiku for structured tasks.
  const anthropicKey = getEnvValueSync(env, "ANTHROPIC_API_KEY");
  if (anthropicKey) return { anthropicKey };
  const apiKey = getEnvValueSync(env, "OPENROUTER_API_KEY");
  // Any OpenAI-compatible endpoint that speaks OpenRouter's chat API; unset
  // means OpenRouter itself.
  const baseURL = getEnvValueSync(env, "OPENROUTER_BASE_URL");
  return apiKey ? { apiKey, baseURL } : null;
}

/**
 * The access a BYOK workspace chose, "missing" when it is BYOK with no AI key
 * (it must never use the deployment's), or null for any other caller.
 */
export async function getWorkspaceLlmAccess(
  organizationId: string | null,
): Promise<OpenRouterAccess | "missing" | null> {
  if (!organizationId) return null;
  const { getCredential, getWorkspaceMode } =
    await import("@/server/features/workspace/credentials");
  if ((await getWorkspaceMode(organizationId)) !== "byok") return null;
  const credential = await getCredential(organizationId, "llm");
  if (!credential) return "missing";
  return credentialToAccess(credential);
}

export function credentialToAccess(credential: {
  provider: string;
  apiKey: string;
  accountId: string | null;
  modelFast: string | null;
  modelSmart: string | null;
}): OpenRouterAccess | "missing" {
  if (!isLlmProvider(credential.provider)) return "missing";
  const info = LLM_PROVIDER_INFO[credential.provider];
  const fastModel = credential.modelFast || info.fastModel;
  const smartModel = credential.modelSmart || info.smartModel;
  if (credential.provider === "anthropic") {
    return { anthropicKey: credential.apiKey, fastModel, smartModel };
  }
  if (credential.provider === "openrouter") {
    // OpenRouter keeps its own routing options, with the chosen model.
    return {
      apiKey: credential.apiKey,
      models: { fast: fastModel, smart: smartModel },
    };
  }
  const baseURL = llmBaseUrl(credential.provider, credential.accountId);
  if (!baseURL) return "missing";
  return { compatKey: credential.apiKey, baseURL, fastModel, smartModel };
}

export const WORKSPACE_LLM_MISSING_MESSAGE =
  "Add an AI provider key in Settings to use AI features.";

/**
 * SAM's model when its Durable Object may serve a BYOK workspace. Think wants
 * a model synchronously, so the workspace is resolved on each call instead:
 * the returned model picks the workspace's own provider (or refuses a BYOK
 * workspace with no key) just before the request goes out.
 */
export function buildWorkspaceSamModel(
  env: object,
  tier: ModelTier,
  resolveOrganizationId: () => Promise<string | null>,
): LanguageModelV3 {
  const envAccess = getOpenRouterAccess(env);
  const base = envAccess
    ? buildChatAgentModel(
        envAccess,
        getEnvValueSync(env, "OPENROUTER_MODEL"),
        tier,
      )
    : // Never called: pick() answers for every request. It only gives the
      // wrapper a provider and model id to report.
      createAnthropic({ apiKey: "unused" })(ANTHROPIC_HAIKU);
  const pick = async (): Promise<LanguageModelV3> => {
    const workspace = await getWorkspaceLlmAccess(
      await resolveOrganizationId(),
    );
    if (workspace === "missing") {
      throw new AppError("VALIDATION_ERROR", WORKSPACE_LLM_MISSING_MESSAGE);
    }
    if (workspace) return buildChatAgentModel(workspace, undefined, tier);
    if (!envAccess) {
      throw new Error("OPENROUTER_API_KEY is required for the SAM agent");
    }
    return base;
  };
  return wrapLanguageModel({
    model: base,
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ params }) => (await pick()).doGenerate(params),
      wrapStream: async ({ params }) => (await pick()).doStream(params),
    },
  });
}

/** For server code: the access, or the error a missing key always threw. */
export async function requireOpenRouterAccess(): Promise<OpenRouterAccess> {
  const workspace = await getWorkspaceLlmAccess(currentWorkspaceId());
  if (workspace === "missing") {
    throw new AppError("VALIDATION_ERROR", WORKSPACE_LLM_MISSING_MESSAGE);
  }
  if (workspace) return workspace;
  const access = getOpenRouterAccess((await getWorkersEnv()) ?? {});
  if (!access) {
    throw new Error(
      "Missing required environment variable: OPENROUTER_API_KEY",
    );
  }
  return access;
}

const ANTHROPIC_SONNET = "claude-sonnet-5-5";
const ANTHROPIC_HAIKU = "claude-haiku-5-5";

// OpenRouter model slug used for the SAM in-app chat agent. Override with
// OPENROUTER_MODEL to swap models without a code change.
const DEFAULT_CHAT_AGENT_MODEL = "openai/gpt-5.6-luna";

// Previous default; kept reachable via OPENROUTER_MODEL for rollback, and the
// fallback where OpenAI is blocked. Its routing needs the ZDR/provider tuning
// below.
const MINIMAX_M3 = "minimax/minimax-m3";

// OpenRouter rejects OpenAI models for requests from these countries ("This
// model is not available in your region"). Workflows and Durable Objects run
// near the user, outside prod's US placement.
const OPENAI_BLOCKED_COUNTRIES = [
  "CN",
  "HK",
  "MO",
  "RU",
  "BY",
  "IR",
  "KP",
  "SY",
  "CU",
];

// The country this isolate's requests leave from. An isolate stays in one
// location, so one lookup serves its lifetime. Caches the value, not the
// promise: Workers can't share a pending fetch across requests. Fails open: a
// slow or failed lookup leaves the country unknown, and calls stay on OpenAI.
let egressCountry: string | undefined;
async function openAiBlockedHere(): Promise<boolean> {
  egressCountry ??= await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
    signal: AbortSignal.timeout(2000),
  })
    .then((response) => response.text())
    .then((trace) => /^loc=(\w+)$/m.exec(trace)?.[1] ?? "")
    .catch(() => "");
  return OPENAI_BLOCKED_COUNTRIES.includes(egressCountry);
}

/**
 * Returns the AI SDK LanguageModel for the chat agent. `usage: { include: true }`
 * turns on OpenRouter usage accounting so each response carries its real USD
 * cost (providerMetadata.openrouter.usage.cost) — which we meter against the
 * shared usage-credit pool.
 *
 * Default model: GPT-5.6 Luna at `reasoning.effort: "max"` — "max" is valid at
 * the OpenRouter API for GPT-5.x but missing from the SDK's effort union, so
 * the reasoning config rides in `extraBody`. Reasoning tokens stream on the
 * separate reasoning channel and are billed as output tokens, which the usage
 * accounting above captures.
 *
 * Sync on purpose: Think's `getModel()` hook is sync and runs on every turn,
 * so the SAM agent reads its access/model from its DO env and builds here.
 */
export function buildChatAgentModel(
  access: OpenRouterAccess,
  modelId?: string,
  tier: ModelTier = "fast",
  // OpenRouter only. Chat turns reason at "max" on the fast model and drafting
  // at "low" on the smart one; a task that is both cheap and mechanical asks
  // for "low" on the fast model.
  reasoningEffort: "max" | "low" = tier === "fast" ? "max" : "low",
): LanguageModelV3 {
  if ("anthropicKey" in access) {
    // OPENROUTER_MODEL slugs don't apply.
    const [fast, smart] = [
      access.fastModel ?? ANTHROPIC_HAIKU,
      access.smartModel ?? ANTHROPIC_SONNET,
    ];
    return createAnthropic({ apiKey: access.anthropicKey })(
      tier === "fast" ? fast : smart,
    );
  }
  if ("compatKey" in access) {
    return createOpenRouter({
      apiKey: access.compatKey,
      baseURL: access.baseURL,
    })(tier === "fast" ? access.fastModel : access.smartModel);
  }
  const chosen =
    "apiKey" in access && access.models
      ? tier === "fast"
        ? access.models.fast
        : access.models.smart
      : modelId;
  const model = chosen ?? DEFAULT_CHAT_AGENT_MODEL;
  const openrouter = createOpenRouter({
    apiKey: access.apiKey,
    baseURL: access.baseURL,
  });
  const primary = openRouterModel(openrouter, model, reasoningEffort);
  // The MiniMax fallback is an OpenRouter slug; another provider may not have it.
  if (!model.startsWith("openai/") || access.baseURL) {
    return primary;
  }
  // Where OpenRouter would reject OpenAI, pick MiniMax M3 before the request.
  // The country lookup is async and getModel() is sync, so it runs per call.
  const fallback = openRouterModel(openrouter, MINIMAX_M3, reasoningEffort);
  const pick = async () => ((await openAiBlockedHere()) ? fallback : primary);
  return wrapLanguageModel({
    model: primary,
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ params }) => (await pick()).doGenerate(params),
      wrapStream: async ({ params }) => (await pick()).doStream(params),
    },
  });
}

function openRouterModel(
  openrouter: OpenRouterProvider,
  model: string,
  reasoningEffort: "max" | "low",
): LanguageModelV3 {
  // MiniMax M3 (env override or OpenAI fallback): `provider.order` prefers
  // Together, then Atlas Cloud (fp8); `zdr: true` restricts routing to Zero-Data-
  // Retention endpoints, which excludes MiniMax first-party — the account's
  // "Non-frontier requires ZDR" data policy enforces the same, this flag is
  // belt-and-braces. Fallbacks stay on within the ZDR set because pinning
  // providers caused a prod outage (Jul 2026: Together upstream-rate-limited
  // m3 and every chat turn 429'd). The explicit reasoning channel keeps m3's
  // `<think>` trace out of the visible answer text.
  if (model === MINIMAX_M3) {
    return openrouter(model, {
      usage: { include: true },
      reasoning: { effort: reasoningEffort === "low" ? "low" : "medium" },
      provider: {
        order: ["together", "atlas-cloud/fp8"],
        zdr: true,
        allow_fallbacks: true,
      },
    });
  }

  return openrouter(model, {
    usage: { include: true },
    extraBody: { reasoning: { effort: reasoningEffort } },
  });
}
