import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRefusal } from "../rules/contentRefusal";
import { draftBrandVoiceGuide } from "./brandVoice";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const {
  generateText,
  listArticles,
  getConnection,
  discoverSiteUrls,
  readPages,
} = vi.hoisted(() => ({
  generateText: vi.fn(),
  listArticles: vi.fn(),
  getConnection: vi.fn(),
  discoverSiteUrls: vi.fn(),
  readPages: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText,
  Output: { object: (value: unknown) => value },
}));
vi.mock("@/server/lib/llmCost", () => ({ llmCostUsd: () => 0 }));
vi.mock("@/server/lib/openrouter", () => ({
  buildChatAgentModel: vi.fn(),
  requireOpenRouterAccess: async () => ({ apiKey: "key" }),
}));
vi.mock("@/server/features/spend/services/SpendService", () => ({
  SpendService: {
    estimateLlmDraftUsd: () => ({ estimatedUsd: 0.15 }),
    assertWithinLimits: vi.fn(),
    recordCost: vi.fn(),
  },
}));
vi.mock("../repositories/ContentRepository", () => ({
  ContentRepository: { getConnection },
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: async () => ({ domain: "pepys.co" }) },
}));
vi.mock("@/server/lib/scrape", () => ({ discoverSiteUrls, readPages }));
vi.mock("./shopifyConnection", () => ({
  storeFor: async () => ({
    listArticles,
    getArticle: async (id: string) => ({
      title: `Title ${id}`,
      bodyHtml: `<p>Body of ${id}</p>`,
      metaTitle: "",
      metaDescription: "",
    }),
  }),
}));

const scope = { projectId: "p", organizationId: "o", userId: "u" };
const article = (externalId: string, isPublished: boolean) => ({
  externalId,
  isPublished,
});

beforeEach(() => {
  getConnection.mockResolvedValue({});
});

describe("brand voice guide", () => {
  it("learns only from published articles", async () => {
    listArticles.mockResolvedValue([
      article("a1", true),
      article("a2", true),
      article("draft", false),
    ]);
    generateText.mockResolvedValue({ output: { guide: "Plain and warm." } });

    const result = await draftBrandVoiceGuide(scope);

    const { prompt } = z
      .object({ prompt: z.string() })
      .parse(generateText.mock.calls[0]?.[0]);
    expect(prompt).toContain("Body of a1");
    expect(prompt).not.toContain("Body of draft");
    expect(result).toEqual({ guide: "Plain and warm.", articlesRead: 2 });
  });

  it("refuses when the blog is too small to learn from", async () => {
    listArticles.mockResolvedValue([article("a1", true), article("d", false)]);

    await expect(draftBrandVoiceGuide(scope)).rejects.toBeInstanceOf(
      ContentRefusal,
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("reads blog posts from the sitemap when no store is connected", async () => {
    getConnection.mockResolvedValue(null);
    discoverSiteUrls.mockResolvedValue({
      urls: [
        "https://pepys.co/",
        "https://pepys.co/pricing",
        "https://pepys.co/blog/first",
        "https://pepys.co/blog/second",
        "https://pepys.co/blog",
      ],
      blocked: false,
    });
    readPages.mockImplementation(async (urls: string[]) => ({
      pages: urls.map((url) => ({ url, title: null, text: `Text of ${url}` })),
      blocked: false,
    }));
    generateText.mockResolvedValue({ output: { guide: "Plain." } });

    const result = await draftBrandVoiceGuide(scope);

    expect(readPages.mock.calls[0]?.[0]).toEqual([
      "https://pepys.co/blog/first",
      "https://pepys.co/blog/second",
    ]);
    expect(result.articlesRead).toBe(2);
  });
});
