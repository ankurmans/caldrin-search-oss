import { waitUntil } from "cloudflare:workers";
import type { CustomerContext } from "@/server/lib/customer-context";
import {
  askSearchEngine,
  searchModelName,
  type SearchAnswer,
  type SearchEngine,
} from "@/server/lib/llm-search";
import { AppError } from "@/server/lib/errors";
import {
  AI_SEARCH_PROMPT_CACHE_NAMESPACE,
  buildCacheKey,
  getCached,
  setCached,
} from "@/server/lib/r2-cache";
import {
  formatCountryLabel,
  formatModelLabel,
} from "@/shared/prompt-explorer-labels";
import {
  ignoresWebSearchCountry,
  supportsWebSearchCountry,
} from "@/shared/prompt-search-countries";
import { safeHostname, safeHttpUrl } from "@/shared/safe-url";
import {
  promptExplorerModelResultSchema,
  type PromptExplorerCitation,
  type PromptExplorerInput,
  type PromptExplorerModel,
  type PromptExplorerModelResult,
  type PromptExplorerResult,
} from "@/types/schemas/ai-search";

/**
 * Prompt Explorer asks one prompt across one-to-four LLM models and renders
 * the answers side by side. Each (prompt, model) tuple is cached in R2 for 7
 * days because LLM responses are expensive and reasonably stable over short
 * windows.
 *
 * Per-model errors are isolated: a Claude API failure must not prevent
 * ChatGPT/Gemini/Perplexity results from rendering. We use Promise.allSettled
 * to enforce that.
 */

/** LLM responses are stable enough for a 7-day cache. */
const PROMPT_RESPONSE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Hard cap on response length. Set to the DataForSEO per-call maximum because
 * reasoning models (gpt-5, gemini) count hidden chain-of-thought
 * tokens against this budget — at 1024 ChatGPT regularly burns the whole
 * budget on reasoning and returns a near-empty visible message.
 */
const PROMPT_RESPONSE_MAX_TOKENS = 4096;

const ENGINE_OF_MODEL: Record<PromptExplorerModel, SearchEngine> = {
  chat_gpt: "chatgpt",
  claude: "claude",
  gemini: "gemini",
  perplexity: "perplexity",
};

export async function explorePrompt(
  input: PromptExplorerInput,
  billingCustomer: CustomerContext,
): Promise<PromptExplorerResult> {
  const highlightBrand = input.highlightBrand?.trim() || null;

  // Dedupe models so a request like ["claude","claude"] doesn't fan out to two
  // paid upstream calls for the same answer.
  const uniqueModels = Array.from(new Set(input.models));

  const settled = await Promise.allSettled(
    uniqueModels.map((model) =>
      runModel({
        model,
        input,
        highlightBrand,
        billingCustomer,
      }),
    ),
  );

  const results: PromptExplorerModelResult[] = settled.map(
    (settledResult, index) => {
      const model = uniqueModels[index];
      if (settledResult.status === "fulfilled") return settledResult.value;
      return mapErrorToResult(model, settledResult.reason);
    },
  );

  return {
    prompt: input.prompt,
    highlightBrand,
    fetchedAt: new Date().toISOString(),
    results,
  };
}

type RunModelArgs = {
  model: PromptExplorerModel;
  input: PromptExplorerInput;
  highlightBrand: string | null;
  billingCustomer: CustomerContext;
};

async function runModel(
  args: RunModelArgs,
): Promise<PromptExplorerModelResult> {
  const country =
    args.input.webSearch && !ignoresWebSearchCountry(args.model)
      ? args.input.webSearchCountryCode
      : undefined;
  if (country && !supportsWebSearchCountry(args.model, country)) {
    const modelLabel = formatModelLabel(args.model);
    return {
      status: "error",
      model: args.model,
      errorCode: "UNSUPPORTED_COUNTRY",
      message: `${modelLabel} doesn’t support ${formatCountryLabel(country)} as a search country. Select “No country preference” above, then run again to include ${modelLabel}.`,
    };
  }
  // Part of the cache key so a model upgrade refetches rather than serving
  // cached answers from the previous model.
  const modelName = searchModelName(ENGINE_OF_MODEL[args.model]);
  const cacheKey = await buildCacheKey(AI_SEARCH_PROMPT_CACHE_NAMESPACE, {
    organizationId: args.billingCustomer.organizationId,
    projectId: args.input.projectId,
    model: args.model,
    modelName,
    // Collapse only whitespace differences. Casing is deliberately preserved:
    // prompts like "Compare Go vs go" or case-sensitive code snippets must
    // not collide with their lowercase twins.
    prompt: normalizePromptForCache(args.input.prompt),
    webSearch: args.input.webSearch,
    webSearchCountryCode: country ?? null,
    // Bumped when prompt/payload shape changes — busts stale cache entries.
    systemPromptV: 7,
  });

  const cached = promptExplorerModelResultSchema.safeParse(
    await getCached(cacheKey),
  );
  if (cached.success && cached.data.status === "success") {
    // highlightBrand is not part of the cache key — re-apply it so the same
    // cached response can power different brand highlights for free.
    return reapplyHighlightBrand(cached.data, args.highlightBrand);
  }

  const answer = await fetchModelResponse(args, country);
  const shaped = {
    ...shapeSuccess(args.model, answer, args.input.webSearch),
    webSearchCountryCode: country ?? null,
  };

  waitUntil(
    setCached(cacheKey, shaped, PROMPT_RESPONSE_TTL_SECONDS, {
      organizationId: args.billingCustomer.organizationId,
    }).catch((err) => {
      console.error("ai-search.prompt-response.cache-write failed:", err);
    }),
  );

  return reapplyHighlightBrand(shaped, args.highlightBrand);
}

function fetchModelResponse(
  args: RunModelArgs,
  country: string | undefined,
): Promise<SearchAnswer> {
  return askSearchEngine(args.billingCustomer, ENGINE_OF_MODEL[args.model], {
    prompt: args.input.prompt,
    webSearch: args.input.webSearch,
    country,
    maxOutputTokens: PROMPT_RESPONSE_MAX_TOKENS,
  });
}

/**
 * Shape a raw LLM response into the brand-agnostic success payload we cache.
 * Brand-specific fields (`matchedBrand`, `brandMentioned`) are computed
 * separately by `reapplyHighlightBrand` on every read so one cache entry can
 * serve requests with different `highlightBrand` values.
 */
function shapeSuccess(
  model: PromptExplorerModel,
  answer: SearchAnswer,
  webSearch: boolean,
): PromptExplorerModelResult {
  return {
    status: "success" as const,
    model,
    modelName: answer.model,
    text: answer.text.trim(),
    citations: extractCitations(answer),
    fanOutQueries: (answer.queries ?? []).slice(0, 20),
    brandMentioned: null,
    outputTokens:
      answer.outputTokens != null ? Math.round(answer.outputTokens) : null,
    webSearch,
    webSearchCountryCode: null,
  };
}

function reapplyHighlightBrand(
  result: PromptExplorerModelResult,
  highlightBrand: string | null,
): PromptExplorerModelResult {
  if (result.status !== "success") return result;
  const citations = result.citations.map((citation) => ({
    ...citation,
    matchedBrand: matchesBrand(citation.url, citation.title, highlightBrand),
  }));
  return {
    ...result,
    citations,
    brandMentioned: computeBrandMentioned(
      result.text,
      citations,
      highlightBrand,
    ),
  };
}

export function extractCitations(
  answer: Pick<SearchAnswer, "citations">,
): PromptExplorerCitation[] {
  const seen = new Set<string>();
  const citations: PromptExplorerCitation[] = [];
  for (const citation of answer.citations) {
    // Models can be coaxed into emitting `javascript:` payloads, and these are
    // rendered as <a href>, so only safe http(s) URLs pass.
    const safeUrl = safeHttpUrl(citation.url);
    if (!safeUrl || seen.has(safeUrl)) continue;
    seen.add(safeUrl);
    citations.push({
      url: safeUrl,
      domain: safeHostname(safeUrl),
      title: citation.title,
      matchedBrand: false,
    });
  }
  return citations.slice(0, 25);
}

function computeBrandMentioned(
  text: string,
  citations: PromptExplorerCitation[],
  highlightBrand: string | null,
): boolean | null {
  if (!highlightBrand) return null;
  if (citations.some((c) => c.matchedBrand)) return true;
  return mentionRegex(highlightBrand).test(text);
}

function matchesBrand(
  url: string,
  title: string | null | undefined,
  highlightBrand: string | null,
): boolean {
  if (!highlightBrand) return false;
  const needle = highlightBrand.toLowerCase();
  const haystack = `${url} ${title ?? ""}`.toLowerCase();
  return haystack.includes(needle);
}

function mentionRegex(brand: string): RegExp {
  // Case-insensitive match on the brand string with word-boundary guards only
  // on sides that end in a word char — otherwise \b fails for brands like
  // "C++" or "AT&T" where the terminal char is non-word. When a boundary char
  // is non-word we guard with a negative lookaround against that same char so
  // "C++" doesn't match "C+++".
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const firstEscaped = brand[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lastEscaped = brand[brand.length - 1].replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const leading = /^\w/.test(brand) ? "\\b" : `(?<!${firstEscaped})`;
  const trailing = /\w$/.test(brand) ? "\\b" : `(?!${lastEscaped})`;
  return new RegExp(`${leading}${escaped}${trailing}`, "i");
}

function normalizePromptForCache(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ");
}

function mapErrorToResult(
  model: PromptExplorerModel,
  reason: unknown,
): PromptExplorerModelResult {
  if (
    reason instanceof AppError &&
    (reason.code === "TRIAL_ENDED" || reason.code === "AUTH_CONFIG_MISSING")
  ) {
    // These account-level failures apply to every model, so surface one clear
    // error instead of silently degrading to per-model failures.
    throw reason;
  }

  // Our own messages for a missing or rejected key tell the person what to fix.
  if (reason instanceof AppError && reason.code === "VALIDATION_ERROR") {
    return {
      status: "error" as const,
      model,
      errorCode: "UPSTREAM_ERROR",
      message: reason.message,
    };
  }

  // Log full upstream detail server-side; surface only a generic message to
  // the client. Upstream error bodies sometimes echo request paths or
  // diagnostic fields we don't want to leak to the browser.
  console.error(`ai-search.prompt-response.${model}.error:`, reason);

  return {
    status: "error" as const,
    model,
    errorCode: "UPSTREAM_ERROR",
    message: "This model is temporarily unavailable. Please try again.",
  };
}
