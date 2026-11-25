import { z } from "zod";
import { postJson } from "./http";
import type { SearchAnswer, SearchRequest } from "./types";

const responseSchema = z.object({
  model: z.string().nullish(),
  output: z.array(
    z.looseObject({
      type: z.string(),
      action: z
        .looseObject({
          query: z.string().nullish(),
          queries: z.array(z.string()).nullish(),
        })
        .nullish(),
      content: z
        .array(
          z.looseObject({
            type: z.string(),
            text: z.string().nullish(),
            annotations: z
              .array(
                z.looseObject({
                  type: z.string(),
                  url: z.string().nullish(),
                  title: z.string().nullish(),
                }),
              )
              .nullish(),
          }),
        )
        .nullish(),
    }),
  ),
  usage: z.looseObject({ output_tokens: z.number().nullish() }).nullish(),
});

// OpenAI appends its own utm_source to every cited link.
function withoutOpenAiTag(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get("utm_source") !== "openai") return url;
    parsed.searchParams.delete("utm_source");
    return parsed.toString();
  } catch {
    return url;
  }
}

/** ChatGPT's models through the Responses API with the web search tool. */
export async function askOpenAi(request: SearchRequest): Promise<SearchAnswer> {
  const data = responseSchema.parse(
    await postJson(
      "OpenAI",
      "https://api.openai.com/v1/responses",
      { authorization: `Bearer ${request.apiKey}` },
      {
        model: request.model,
        input: request.prompt,
        // Reasoning tokens count toward the cap; without a low effort a
        // search answer is cut off before it names anything.
        reasoning: { effort: "low" },
        max_output_tokens: request.maxOutputTokens,
        ...(request.webSearch
          ? {
              tools: [
                {
                  type: "web_search",
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
              tool_choice: "required",
            }
          : {}),
      },
    ),
  );
  const parts = data.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text");
  return {
    text: parts.map((part) => part.text ?? "").join(""),
    citations: parts.flatMap((part) =>
      (part.annotations ?? []).flatMap((a) =>
        a.type === "url_citation" && a.url
          ? [{ url: withoutOpenAiTag(a.url), title: a.title ?? null }]
          : [],
      ),
    ),
    queries: data.output.flatMap((item) =>
      item.type === "web_search_call"
        ? (item.action?.queries ??
          (item.action?.query ? [item.action.query] : []))
        : [],
    ),
    model: data.model ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  };
}
