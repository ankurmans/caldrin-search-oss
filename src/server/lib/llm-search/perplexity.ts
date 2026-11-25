import { z } from "zod";
import { postJson } from "./http";
import type { SearchAnswer, SearchRequest } from "./types";

const responseSchema = z.object({
  model: z.string().nullish(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullish() }) }))
    .min(1),
  citations: z.array(z.string()).nullish(),
  search_results: z
    .array(z.looseObject({ url: z.string(), title: z.string().nullish() }))
    .nullish(),
  usage: z.looseObject({ completion_tokens: z.number().nullish() }).nullish(),
});

/** Perplexity Sonar, which always searches the web. */
export async function askPerplexity(
  request: SearchRequest,
): Promise<SearchAnswer> {
  const data = responseSchema.parse(
    await postJson(
      "Perplexity",
      "https://api.perplexity.ai/chat/completions",
      { authorization: `Bearer ${request.apiKey}` },
      {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        messages: [{ role: "user", content: request.prompt }],
        ...(request.country
          ? {
              web_search_options: {
                user_location: { country: request.country },
              },
            }
          : {}),
      },
    ),
  );
  const titles = new Map(
    (data.search_results ?? []).map((r) => [r.url, r.title ?? null]),
  );
  const urls = data.citations ?? (data.search_results ?? []).map((r) => r.url);
  return {
    text: data.choices[0].message.content ?? "",
    citations: urls.map((url) => ({ url, title: titles.get(url) ?? null })),
    queries: null,
    model: data.model ?? null,
    outputTokens: data.usage?.completion_tokens ?? null,
  };
}
