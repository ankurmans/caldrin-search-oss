import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askAnthropic } from "./anthropic";
import { askGemini } from "./gemini";
import { askOpenAi } from "./openai";
import { askPerplexity } from "./perplexity";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const request = {
  prompt: "Best ride-on excavator?",
  apiKey: "key",
  model: "m",
  maxOutputTokens: 100,
  webSearch: true,
  country: "US",
};

function respondWith(body: unknown, status = 200) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const sentBody = (fetchMock: ReturnType<typeof respondWith>): unknown =>
  JSON.parse(z.string().parse(fetchMock.mock.calls[0][1]?.body));

afterEach(() => vi.unstubAllGlobals());

describe("answer engines called directly", () => {
  it("reads Claude's text, cited pages and searches, and asks it to search", async () => {
    const fetchMock = respondWith({
      model: "claude-sonnet-5-5",
      content: [
        {
          type: "server_tool_use",
          name: "web_search",
          input: { query: "ride-on excavator" },
        },
        { type: "web_search_tool_result", content: [] },
        {
          type: "text",
          text: "Try Acme.",
          citations: [{ url: "https://acme.example/", title: "Acme" }],
        },
      ],
      usage: { output_tokens: 42 },
    });
    expect(await askAnthropic(request)).toEqual({
      text: "Try Acme.",
      citations: [{ url: "https://acme.example/", title: "Acme" }],
      queries: ["ride-on excavator"],
      model: "claude-sonnet-5-5",
      outputTokens: 42,
    });
    expect(sentBody(fetchMock)).toMatchObject({
      system: "Search the web before answering.",
      tools: [{ name: "web_search", user_location: { country: "US" } }],
    });
  });

  it("sends no search tool when web search is off", async () => {
    const fetchMock = respondWith({
      content: [{ type: "text", text: "From memory." }],
    });
    await askAnthropic({ ...request, webSearch: false });
    expect(sentBody(fetchMock)).not.toHaveProperty("tools");
  });

  it("reads Perplexity's citations with titles and reports no searches", async () => {
    respondWith({
      model: "sonar-pro",
      choices: [{ message: { content: "Try Acme." } }],
      citations: ["https://acme.example/"],
      search_results: [{ url: "https://acme.example/", title: "Acme" }],
      usage: { completion_tokens: 7 },
    });
    expect(await askPerplexity(request)).toMatchObject({
      text: "Try Acme.",
      citations: [{ url: "https://acme.example/", title: "Acme" }],
      queries: null,
      outputTokens: 7,
    });
  });

  it("reads OpenAI's answer, url citations and searches", async () => {
    respondWith({
      model: "gpt-5.5",
      output: [
        {
          type: "web_search_call",
          action: { type: "search", query: "excavator" },
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Try Acme.",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://acme.example/",
                  title: "Acme",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(await askOpenAi(request)).toMatchObject({
      text: "Try Acme.",
      citations: [{ url: "https://acme.example/", title: "Acme" }],
      queries: ["excavator"],
    });
  });

  it("resolves Gemini's redirect sources to the pages they point at", async () => {
    const redirect =
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          candidates: [
            {
              content: { parts: [{ text: "Try Acme." }] },
              groundingMetadata: {
                webSearchQueries: ["excavator"],
                groundingChunks: [
                  { web: { uri: redirect, title: "acme.example" } },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://acme.example/excavators" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(await askGemini(request)).toMatchObject({
      text: "Try Acme.",
      citations: [
        { url: "https://acme.example/excavators", title: "acme.example" },
      ],
      queries: ["excavator"],
    });
  });

  it("says what to fix when the provider rejects the key, without echoing its reply", async () => {
    respondWith({ error: { message: "bad key sk-secret" } }, 401);
    await expect(askAnthropic(request)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Anthropic rejected the API key. Check the key in Settings.",
    });
  });
});
