import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCached, setCached, buildCacheKey } from "@/server/lib/r2-cache";
import { promptExplorerInputSchema } from "@/types/schemas/ai-search";
import { explorePrompt, extractCitations } from "./promptExplorer";

vi.mock("cloudflare:workers", () => ({ waitUntil: vi.fn() }));

const { askSearchEngine } = vi.hoisted(() => ({ askSearchEngine: vi.fn() }));
vi.mock("@/server/lib/llm-search", () => ({
  askSearchEngine,
  searchModelName: () => "gpt-5.5",
}));
vi.mock("@/server/lib/r2-cache", () => ({
  AI_SEARCH_PROMPT_CACHE_NAMESPACE: "ai-search-prompt",
  buildCacheKey: vi.fn(async () => "cache-key"),
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => {}),
}));

describe("extractCitations", () => {
  it("keeps cited pages with their domain and title", () => {
    const citations = extractCitations({
      citations: [
        { title: "Town & Country", url: "https://www.townandcountrymag.com/x" },
        { title: null, url: "https://www.stylevana.com/y" },
      ],
    });
    expect(citations.map((c) => c.url)).toEqual([
      "https://www.townandcountrymag.com/x",
      "https://www.stylevana.com/y",
    ]);
    expect(citations[0]).toMatchObject({
      domain: "townandcountrymag.com",
      title: "Town & Country",
    });
  });

  it("dedupes repeated URLs and drops unsafe schemes", () => {
    const citations = extractCitations({
      citations: [
        { title: "A", url: "https://example.com/a" },
        { title: "A dup", url: "https://example.com/a" },
        { title: "evil", url: "javascript:alert(1)" },
      ],
    });
    expect(citations).toHaveLength(1);
    expect(citations[0]?.url).toBe("https://example.com/a");
  });
});

const answer = {
  text: "answer",
  citations: [{ title: "Source", url: "https://example.com/post" }],
  queries: ["best open source seo tool"],
  model: "gpt-5.5",
  outputTokens: 10,
};

describe("Prompt Explorer countries", () => {
  const billing = {
    organizationId: "org_1",
    userId: "user_1",
    userEmail: "a@b.c",
  };
  const input = {
    projectId: "p1",
    prompt: "Кое студио в София бихте препоръчали за PPF защитно фолио?",
    models: ["chat_gpt", "claude", "gemini", "perplexity"] as const,
    webSearch: true,
    webSearchCountryCode: "BG" as const,
  };

  beforeEach(() => {
    askSearchEngine.mockResolvedValue(answer);
    vi.mocked(getCached).mockResolvedValue(null);
    vi.mocked(setCached).mockResolvedValue(undefined);
    vi.mocked(buildCacheKey).mockImplementation(async (_namespace, params) =>
      JSON.stringify(params),
    );
  });

  it("skips a model that doesn't list the country without spending on it, and runs Gemini without one", async () => {
    const result = await explorePrompt(
      promptExplorerInputSchema.parse(input),
      billing,
    );
    expect(result.results).toMatchObject([
      { model: "chat_gpt", status: "success", webSearchCountryCode: "BG" },
      { model: "claude", status: "error", errorCode: "UNSUPPORTED_COUNTRY" },
      { model: "gemini", status: "success", webSearchCountryCode: null },
      { model: "perplexity", status: "success", webSearchCountryCode: "BG" },
    ]);
    expect(askSearchEngine).toHaveBeenCalledTimes(3);
    expect(askSearchEngine).toHaveBeenCalledWith(
      billing,
      "gemini",
      expect.objectContaining({ country: undefined }),
    );
  });

  it.each([false, true])(
    "runs all models without a hint when webSearch=%s and no country applies",
    async (webSearch) => {
      const result = await explorePrompt(
        promptExplorerInputSchema.parse({
          ...input,
          webSearch,
          webSearchCountryCode: webSearch ? undefined : "BG",
        }),
        billing,
      );
      expect(
        result.results.every(
          (r) => r.status === "success" && r.webSearchCountryCode === null,
        ),
      ).toBe(true);
      expect(askSearchEngine).toHaveBeenCalledTimes(4);
    },
  );

  it("keeps country-specific cached answers separate and restores their hint", async () => {
    const cache = new Map<string, unknown>();
    vi.mocked(getCached).mockImplementation(
      async (key) => cache.get(key) ?? null,
    );
    vi.mocked(setCached).mockImplementation(async (key, value) => {
      cache.set(key, value);
    });
    const run = (cc: string | undefined) =>
      explorePrompt(
        promptExplorerInputSchema.parse({
          ...input,
          models: ["chat_gpt"],
          webSearchCountryCode: cc,
        }),
        billing,
      );
    await run("US");
    await run("BG");
    await run(undefined);
    const repeated = await run("BG");
    expect(askSearchEngine).toHaveBeenCalledTimes(3);
    expect(repeated.results[0]).toMatchObject({
      status: "success",
      webSearchCountryCode: "BG",
    });
  });
});
