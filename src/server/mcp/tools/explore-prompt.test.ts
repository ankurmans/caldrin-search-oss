import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { explorePromptTool } from "./explore-prompt";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  response: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
  DurableObject: class {
    kind = "mock";
  },
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: { getProjectForOrganization: mocks.authorize },
}));
vi.mock("@/server/lib/llm-search", () => ({
  askSearchEngine: mocks.response,
  searchModelName: () => "gpt-5.5",
}));
vi.mock("@/server/lib/r2-cache", () => ({
  AI_SEARCH_PROMPT_CACHE_NAMESPACE: "ai-search-prompt",
  buildCacheKey: vi.fn(async () => "cache-key"),
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => {}),
}));

const projectId = "project_1";
const context = makeToolContext();
const input = z.object(explorePromptTool.config.inputSchema);

beforeEach(() => {
  mocks.authorize.mockResolvedValue({ id: projectId, domain: "example.com" });
  mocks.response.mockResolvedValue({
    text: "Acme is an option.",
    citations: [{ url: "https://acme.example/", title: null }],
    queries: null,
    model: "gpt-5.5",
    outputTokens: null,
  });
});

describe("explore_prompt", () => {
  it.each([
    { models: undefined, expected: ["chat_gpt"] },
    {
      models: ["chat_gpt", "gemini", "chat_gpt"],
      expected: ["chat_gpt", "gemini"],
    },
  ])(
    "bills only the selected models, defaulting to ChatGPT: $models",
    async ({ models, expected }) => {
      const args = input.parse({ projectId, prompt: "Which tool?", models });
      const result = await explorePromptTool.handler(args, context);
      expect(mocks.response).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_123", projectId }),
        expect.any(String),
        expect.anything(),
      );
      expect(
        mocks.response.mock.calls.map(([, engine]): unknown => engine),
      ).toEqual(expected.map((m) => (m === "chat_gpt" ? "chatgpt" : m)));
      expect(result.structuredContent.results).toMatchObject(
        expected.map((model) => ({
          model,
          status: "success",
          text: "Acme is an option.",
          citations: [{ url: "https://acme.example/" }],
        })),
      );
      const text = textContent(result);
      expect(text).toContain("Acme is an option.");
      expect(text).toContain("https://acme.example/");
      const url = new URL(String(result.structuredContent.meta?.url));
      expect(JSON.parse(url.searchParams.get("models")!)).toEqual(args.models);
    },
  );

  it.each([
    {
      models: ["chat_gpt", "gemini"],
      locationCode: 2724,
      named: undefined,
      sent: ["ES", undefined],
    },
    {
      models: ["chat_gpt", "claude"],
      locationCode: 2100,
      named: undefined,
      sent: [undefined, undefined],
    },
    {
      models: ["chat_gpt"],
      locationCode: 2724,
      named: "BG",
      sent: ["BG"],
    },
  ])(
    "asks in the project's country unless a model would be skipped or one is named: $models in $locationCode, named $named",
    async ({ models, locationCode, named, sent }) => {
      mocks.authorize.mockResolvedValue({
        id: projectId,
        domain: "example.com",
        locationCode,
      });
      const result = await explorePromptTool.handler(
        input.parse({
          projectId,
          prompt: "Which tool?",
          models,
          webSearchCountryCode: named,
        }),
        context,
      );
      expect(
        mocks.response.mock.calls.map(
          ([, , call]) =>
            z.object({ country: z.unknown() }).parse(call).country,
        ),
      ).toEqual(sent);
      expect(result.structuredContent.results).toMatchObject(
        models.map(() => ({ status: "success" })),
      );
    },
  );

  it("rejects a foreign project before a paid model call", async () => {
    mocks.authorize.mockResolvedValue(null);
    await expect(
      explorePromptTool.handler(
        input.parse({ projectId, prompt: "Which tool?" }),
        context,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.response).not.toHaveBeenCalled();
  });
});
