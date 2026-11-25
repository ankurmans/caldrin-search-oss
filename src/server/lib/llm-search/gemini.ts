import { z } from "zod";
import { postJson } from "./http";
import type { SearchAnswer, SearchRequest } from "./types";

const responseSchema = z.object({
  modelVersion: z.string().nullish(),
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.looseObject({ text: z.string().nullish() })),
          })
          .nullish(),
        groundingMetadata: z
          .looseObject({
            webSearchQueries: z.array(z.string()).nullish(),
            groundingChunks: z
              .array(
                z.looseObject({
                  web: z
                    .looseObject({
                      uri: z.string().nullish(),
                      title: z.string().nullish(),
                    })
                    .nullish(),
                }),
              )
              .nullish(),
          })
          .nullish(),
      }),
    )
    .min(1),
  usageMetadata: z
    .looseObject({ candidatesTokenCount: z.number().nullish() })
    .nullish(),
});

const GROUNDING_HOST = "vertexaisearch.cloud.google.com";
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * Google lists each source as a redirect through its own host. The redirect's
 * target is the page; when it cannot be read, the source is the site the
 * title names, which is how Google labels it.
 */
async function sourceUrl(uri: string, title: string | null) {
  if (new URL(uri).hostname !== GROUNDING_HOST) return uri;
  try {
    const response = await fetch(uri, { redirect: "manual" });
    const location = response.headers.get("location");
    if (location) return location;
  } catch {
    // Falls through to the title.
  }
  return title && HOSTNAME.test(title) ? `https://${title}` : null;
}

/** Gemini through generateContent with Google Search grounding. */
export async function askGemini(request: SearchRequest): Promise<SearchAnswer> {
  const data = responseSchema.parse(
    await postJson(
      "Google Gemini",
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
      { "x-goog-api-key": request.apiKey },
      {
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        ...(request.webSearch ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: { maxOutputTokens: request.maxOutputTokens },
      },
    ),
  );
  const candidate = data.candidates[0];
  const chunks = (candidate.groundingMetadata?.groundingChunks ?? []).flatMap(
    (chunk) => (chunk.web?.uri ? [chunk.web] : []),
  );
  const resolved = await Promise.all(
    chunks.map(async (web) => {
      const title = web.title ?? null;
      const url = await sourceUrl(web.uri!, title);
      return url ? { url, title } : null;
    }),
  );
  return {
    text: (candidate.content?.parts ?? []).map((p) => p.text ?? "").join(""),
    citations: resolved.filter((c) => c !== null),
    queries: candidate.groundingMetadata?.webSearchQueries ?? [],
    model: data.modelVersion ?? null,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
  };
}
