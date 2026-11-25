import { z } from "zod";
import { postJson } from "./http";
import type { SearchAnswer, SearchRequest } from "./types";

const responseSchema = z.object({
  model: z.string().nullish(),
  content: z.array(
    z.looseObject({
      type: z.string(),
      text: z.string().nullish(),
      citations: z
        .array(
          z.looseObject({
            url: z.string().nullish(),
            title: z.string().nullish(),
          }),
        )
        .nullish(),
      input: z.looseObject({ query: z.string().nullish() }).nullish(),
      name: z.string().nullish(),
    }),
  ),
  usage: z.looseObject({ output_tokens: z.number().nullish() }).nullish(),
});

/** Claude through the Messages API with the web search tool. */
export async function askAnthropic(
  request: SearchRequest,
): Promise<SearchAnswer> {
  const data = responseSchema.parse(
    await postJson(
      "Anthropic",
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": request.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        messages: [{ role: "user", content: request.prompt }],
        ...(request.webSearch
          ? {
              tools: [
                {
                  type: "web_search_20250305",
                  name: "web_search",
                  max_uses: 5,
                  ...(request.country
                    ? {
                        user_location: {
                          type: "approximate",
                          country: request.country,
                        },
                      }
                    : {}),
                },
              ],
              // Newer models reject a forced tool choice, and a model that may
              // search can answer from memory and cite nothing, so it is asked to.
              system: "Search the web before answering.",
            }
          : {}),
      },
    ),
  );
  const text = data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  return {
    text,
    citations: data.content.flatMap((block) =>
      (block.citations ?? []).flatMap((c) =>
        c.url ? [{ url: c.url, title: c.title ?? null }] : [],
      ),
    ),
    queries: data.content.flatMap((block) =>
      block.type === "server_tool_use" && block.input?.query
        ? [block.input.query]
        : [],
    ),
    model: data.model ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  };
}
