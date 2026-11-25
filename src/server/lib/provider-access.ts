import { workspaceProviderKey } from "@/server/lib/workspace-provider-key";
import type { SearchProvider } from "@/server/lib/search-provider";
import { AppError } from "@/server/lib/errors";
import {
  getOptionalEnvValue,
  getRequiredEnvValue,
} from "@/server/lib/runtime-env";

// How Caldrin Search reaches the APIs it calls with a key (DataForSEO,
// TinyFish). A BYOK workspace uses the key it brought and never the
// deployment's; every other call uses the deployment's own key.

function withAuthorization(authorization: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", authorization);
    return fetch(input, { ...init, headers });
  };
}

/** A fetch that reaches DataForSEO authenticated, for this deployment. */
export async function getDataforseoFetch(): Promise<typeof fetch> {
  const workspace = await workspaceProviderKey("dataforseo");
  if (workspace && !workspace.key) {
    throw new AppError(
      "DATAFORSEO_AUTH_FAILED",
      "Add your DataForSEO key in Settings to run research.",
    );
  }
  if (workspace?.key) return withAuthorization(`Basic ${workspace.key}`);
  const apiKey = await getRequiredEnvValue("DATAFORSEO_API_KEY");
  return withAuthorization(`Basic ${apiKey}`);
}

/** A fetch that reaches TinyFish authenticated, or null without a key. */
export async function getTinyfishFetch(): Promise<typeof fetch | null> {
  const workspace = await workspaceProviderKey("tinyfish");
  if (workspace && !workspace.key) return null;
  const apiKey =
    workspace?.key ?? (await getOptionalEnvValue("TINYFISH_API_KEY"));
  if (!apiKey) return null;
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("X-API-Key", apiKey);
    return fetch(input, { ...init, headers });
  };
}

const KEY_ENV: Record<SearchProvider, string> = {
  dataforseo: "DATAFORSEO_API_KEY",
  tinyfish: "TINYFISH_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const MODEL_PROVIDER_LABELS = {
  anthropic: "Anthropic",
  perplexity: "Perplexity",
  openai: "OpenAI",
  gemini: "Google Gemini",
} as const;

/**
 * The key for one answer-engine provider, called directly with no middleman.
 * A BYOK workspace uses the key it brought; every other workspace uses the
 * deployment's. Throws a message a person can act on when there is none.
 */
export async function getModelProviderKey(
  provider: keyof typeof MODEL_PROVIDER_LABELS,
): Promise<string> {
  const workspace = await workspaceProviderKey(provider);
  const key = workspace
    ? workspace.key
    : await getOptionalEnvValue(KEY_ENV[provider]);
  if (key) return key;
  throw new AppError(
    "VALIDATION_ERROR",
    workspace
      ? `Add your ${MODEL_PROVIDER_LABELS[provider]} key in Settings to ask this engine.`
      : `${MODEL_PROVIDER_LABELS[provider]} is not set up on this deployment.`,
  );
}

/** Whether calls to the provider would go through, without making one. */
export async function hasProviderAccess(
  provider: SearchProvider,
): Promise<boolean> {
  const workspace = await workspaceProviderKey(provider);
  if (workspace) return workspace.key !== null;
  return Boolean(await getOptionalEnvValue(KEY_ENV[provider]));
}

export function hasDataforseoAccess(): Promise<boolean> {
  return hasProviderAccess("dataforseo");
}
