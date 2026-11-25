/** The answer engines reached through their own provider API. */
export type SearchEngine = "claude" | "perplexity" | "chatgpt" | "gemini";

export interface SearchAnswer {
  text: string;
  citations: { url: string; title: string | null }[];
  /** The searches the model ran; null when the provider does not report them. */
  queries: string[] | null;
  model: string | null;
  outputTokens: number | null;
}

export interface SearchRequest {
  prompt: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  /** Whether the model may search the web. Perplexity always does. */
  webSearch: boolean;
  /** ISO 3166-1 alpha-2 country that geolocates the web search. */
  country?: string;
}
