import { z } from "zod";
import { safeHttpUrl } from "@/shared/safe-url";
import type { AiEngine } from "@/shared/ai-visibility";
import type { SearchAnswer } from "@/server/lib/llm-search/types";

const optionalMarkdown = z.string().max(1_000_000).nullish();
const sourceList = z.array(z.unknown()).max(2_000).nullish();
const resultSchema = z.object({
  datetime: z.string().max(100).nullish(),
  // ChatGPT and Gemini LLM Scraper fields.
  markdown: optionalMarkdown,
  model: z.string().max(200).nullish(),
  sources: sourceList,
  // Pages the engine retrieved, cited or not, and the searches it reported.
  search_results: sourceList,
  fan_out_queries: z.array(z.string().max(2_000)).max(200).nullish(),
  // Google organic and AI Mode SERP field.
  items: z.array(z.unknown()).max(500).nullish(),
});
const aiOverviewElementSchema = z.object({
  type: z.string().nullish(),
  references: sourceList,
  // A shopping element's product cards, and its text with each card in place.
  markdown: optionalMarkdown,
  items: z
    .array(
      z.object({ title: z.string().nullish(), seller: z.string().nullish() }),
    )
    .max(500)
    .nullish(),
});
const aiOverviewSchema = z.object({
  type: z.literal("ai_overview"),
  markdown: optionalMarkdown,
  references: sourceList,
  items: z.array(aiOverviewElementSchema).max(500).nullish(),
});
const sourceSchema = z.object({
  url: z.string().max(16_384),
  title: z.string().max(10_000).transform(withoutNul).nullish(),
});
const retrievalSchema = sourceSchema.extend({
  description: z.string().max(20_000).transform(withoutNul).nullish(),
});

type AiCitationOrigin = "provider_source" | "answer_link";

export interface AiCitation {
  url: string;
  domain: string;
  title: string | null;
  position: number;
  origin: AiCitationOrigin;
}

/** A product card the engine showed, with only what the provider reports. */
export interface AiProduct {
  position: number;
  title: string;
  price: number | null;
  currency: string | null;
  tag: string | null;
  providerField: string;
}

/** A page the provider says the engine retrieved while answering. */
export interface AiRetrieval {
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
  position: number;
}

export interface ParsedAiAnswer {
  /** Null when the engine gave no answer (or Google showed no AI Overview). */
  answerMarkdown: string | null;
  /** Plain prose for brand matching; empty without an answer. */
  answerText: string;
  citations: AiCitation[];
  /**
   * Searches the provider reported the engine ran. Null when the provider's
   * result has no such field, so "not exposed" never reads as "none".
   */
  queries: string[] | null;
  /** Pages the provider reported as retrieved; null when not exposed. */
  retrievals: AiRetrieval[] | null;
  /** Product cards shown, in order. Empty when the answer shows none. */
  products: AiProduct[];
  collectedAt: string | null;
  /**
   * The model the provider says answered, or null when its response names
   * none. Never inferred from the requested model or the engine.
   */
  model: string | null;
}

/**
 * Normalize one DataForSEO task result. No URL fetches or model calls: all
 * evidence comes from the captured result. Returns null for an unreadable
 * result.
 */
export function parseDataforseoAnswer(
  raw: unknown,
  engine: AiEngine,
): ParsedAiAnswer | null {
  if (raw === null)
    return {
      answerMarkdown: null,
      answerText: "",
      citations: [],
      queries: null,
      retrievals: null,
      products: [],
      collectedAt: null,
      model: null,
    };
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const result = parsed.data;
  let markdown: string | null;
  let sources: SourceInput[];
  // An AI Mode answer comes back as an `ai_overview` item too.
  const scrapes =
    engine !== "google_ai_overview" && engine !== "google_ai_mode";
  if (!scrapes) {
    const overview = result.items
      ?.map((item) => aiOverviewSchema.safeParse(item))
      .find((item) => item.success)?.data;
    markdown = overview?.markdown
      ? withProductCards(overview.markdown, overview.items ?? [])
      : null;
    sources = [
      ...[
        ...(overview?.references ?? []),
        ...(overview?.items ?? []).flatMap((item) => item.references ?? []),
      ].map((item) => ({ item, origin: "provider_source" as const })),
      // A store or site the answer links to in its text is cited too, even
      // when Google lists no source for it.
      ...(markdown ? linkedPages(markdown) : []).map((item) => ({
        item,
        origin: "answer_link" as const,
      })),
    ];
  } else {
    markdown = result.markdown ?? null;
    sources = (result.sources ?? []).map((item) => ({
      item,
      origin: "provider_source" as const,
    }));
  }
  if (markdown) markdown = withoutNul(markdown);
  const answerText = markdown ? markdownToText(markdown) : "";
  return {
    answerMarkdown: answerText.trim() ? markdown : null,
    answerText: answerText.trim() ? answerText : "",
    citations: citationsFrom(sources),
    // Google's SERP results carry neither field; the ChatGPT and Gemini
    // scrapers do, and a result that omits one stays null.
    queries:
      scrapes && result.fan_out_queries
        ? result.fan_out_queries.map((query) => query.trim()).filter(Boolean)
        : null,
    retrievals:
      scrapes && result.search_results
        ? retrievalsFrom(result.search_results)
        : null,
    products: scrapes ? productsFrom(result.items ?? []) : [],
    collectedAt: dateOrNull(result.datetime),
    // The scraper names the model it ran. Google results name none.
    model: scrapes ? result.model?.trim() || null : null,
  };
}

/**
 * Pages the answer links to in its text, leaving out images and Google's own
 * links: redirects that hide where they go, and Google Shopping pages.
 */
function linkedPages(markdown: string): { url: string }[] {
  return Array.from(
    markdown.matchAll(
      /(?<!!)\[(?:[^[\]]|\[[^\]]*\])*\]\((https?:\/\/[^)\s]+)\)/g,
    ),
    ([, url]) => ({ url }),
  ).filter(({ url }) => !/^https?:\/\/([a-z0-9-]+\.)*google\.com\//i.test(url));
}

/** A product card in a shopping element: `[![name](image)](product page)`. */
const PRODUCT_CARD = /\[!\[([^\]]*)\]\([^)\s]*\)\]\([^)\s]*\)\s*/g;

/**
 * Google AI Mode shows product cards, each with a product's name and a store.
 * DataForSEO leaves the cards out of the answer's markdown and keeps them in
 * the shopping element, whose markdown is the same text with each card in
 * place. This puts each card back as its name and store, which are text the
 * answer shows.
 */
function withProductCards(
  markdown: string,
  elements: z.infer<typeof aiOverviewElementSchema>[],
): string {
  for (const element of elements) {
    const cards = element.markdown;
    if (element.type !== "ai_overview_shopping" || !cards) continue;
    markdown = markdown.replace(cards.replace(PRODUCT_CARD, ""), () => {
      let card = 0;
      // The cards and the products are in the same order. A card's own name
      // is HTML-escaped, so the product's title is used when there is one.
      return cards.replace(PRODUCT_CARD, (_, name: string) => {
        const product = element.items?.[card++];
        const store = product?.seller ? ` · ${product.seller}` : "";
        return `**${product?.title ?? name}**${store}\n\n`;
      });
    });
  }
  return markdown;
}

/** An answer a model gave through its own provider API, with its web search. */
export function parseModelAnswer(answer: SearchAnswer): ParsedAiAnswer {
  const markdown = withoutNul(answer.text.trim());
  const answerText = markdownToText(markdown);
  return {
    answerMarkdown: answerText.trim() ? markdown : null,
    answerText: answerText.trim() ? answerText : "",
    citations: citationsFrom(
      answer.citations.map((item) => ({
        item,
        origin: "provider_source" as const,
      })),
    ),
    queries:
      answer.queries?.map((query) => query.trim()).filter(Boolean) ?? null,
    retrievals: null,
    products: [],
    collectedAt: null,
    model: answer.model?.trim() || null,
  };
}

/** Postgres text columns reject NUL, which scraped answers and titles can carry. */
function withoutNul(text: string): string {
  return text.replaceAll("\0", "");
}

function dateOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

/**
 * Plain answer prose for brand matching. Citation pills (`[1]`, `[example.com]`)
 * are evidence of a source, not a textual mention, so they are removed.
 */
export function markdownToText(markdown: string): string {
  return (
    markdown
      .replace(/!\[[^\]]*\]\([^)\s]*\)/g, "")
      .replace(
        /\[((?:[^[\]]|\[[^\]]*\])*)\]\((https?:\/\/[^)\s]+)\)/g,
        (_, label: string, url: string) =>
          citationPill(label, url) ? "" : label,
      )
      .replace(/\*\*|__|`/g, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^(\s*)[*+-]\s+/gm, "$1")
      // Markdown backslash escapes ("1\.", "platform\.") are not part of the
      // words the engine wrote.
      .replace(/\\([!-/:-@[-`{-~])/g, "$1")
      // Engines sometimes return HTML entities ("E&amp;S"). The text is
      // always rendered as text, so decoding them cannot inject markup.
      .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, decodeEntity)
  );
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntity(entity: string, name: string): string {
  const lower = name.toLowerCase();
  if (NAMED_ENTITIES[lower]) return NAMED_ENTITIES[lower];
  const code = lower.startsWith("#x")
    ? Number.parseInt(lower.slice(2), 16)
    : Number.parseInt(lower.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
}

function citationPill(label: string, url: string): boolean {
  const text = label
    .replace(/^\[|\]$/g, "")
    .trim()
    .toLowerCase();
  if (/^\d+$/.test(text)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return text.replace(/^www\./, "") === host.replace(/^www\./, "");
  } catch {
    return false;
  }
}

type SourceInput = { item: unknown; origin: AiCitationOrigin };

/** A URL the app can show: safe to link, no fragment, no tracking parameters. */
function cleanUrl(raw: string): URL | null {
  const safe = safeHttpUrl(raw);
  if (!safe) return null;
  const url = new URL(safe);
  url.hash = "";
  // Snapshot keys before deleting: the URLSearchParams iterator is live.
  for (const key of Array.from(url.searchParams.keys()))
    if (
      /^utm_/i.test(key) ||
      ["gclid", "fbclid", "msclkid"].includes(key.toLowerCase())
    )
      url.searchParams.delete(key);
  return url;
}

/**
 * Safe, de-duplicated cited URLs. A page the provider lists as a source keeps
 * that origin even when the answer text links to it first.
 */
function citationsFrom(list: SourceInput[]): AiCitation[] {
  const citations = new Map<string, AiCitation>();
  for (const { item, origin } of list) {
    const source = sourceSchema.safeParse(item);
    const url = source.success ? cleanUrl(source.data.url) : null;
    if (!source.success || !url) continue;
    const normalized = url.toString();
    const existing = citations.get(normalized);
    if (existing) {
      existing.title ??= source.data.title ?? null;
      if (origin === "provider_source") existing.origin = origin;
      continue;
    }
    citations.set(normalized, {
      url: normalized,
      domain: url.hostname,
      title: source.data.title ?? null,
      position: citations.size + 1,
      origin,
    });
  }
  return [...citations.values()];
}

/** Safe, de-duplicated retrieved pages, in the order the provider listed them. */
function retrievalsFrom(list: unknown[]): AiRetrieval[] {
  const retrievals = new Map<string, AiRetrieval>();
  for (const item of list) {
    const page = retrievalSchema.safeParse(item);
    const url = page.success ? cleanUrl(page.data.url) : null;
    if (!page.success || !url) continue;
    const normalized = url.toString();
    if (retrievals.has(normalized)) continue;
    retrievals.set(normalized, {
      url: normalized,
      domain: url.hostname,
      title: page.data.title ?? null,
      description: page.data.description ?? null,
      position: retrievals.size + 1,
    });
  }
  return [...retrievals.values()];
}

const productElementSchema = z.object({
  type: z.literal("chat_gpt_products_element"),
  title: z.string().max(2_000).transform(withoutNul),
  price: z.number().finite().nonnegative().nullish(),
  currency: z.string().max(10).nullish(),
  tag: z.string().max(200).transform(withoutNul).nullish(),
});

/** The ChatGPT scraper's products element: cards listed in answer order. */
function productsFrom(items: unknown[]): AiProduct[] {
  const products: AiProduct[] = [];
  for (const item of items) {
    const group = z
      .object({
        type: z.literal("chat_gpt_products"),
        items: z.array(z.unknown()).max(200),
      })
      .safeParse(item);
    if (!group.success) continue;
    for (const card of group.data.items) {
      const parsed = productElementSchema.safeParse(card);
      const title = parsed.success ? parsed.data.title.trim() : "";
      if (!parsed.success || !title) continue;
      products.push({
        position: products.length + 1,
        title,
        price: parsed.data.price ?? null,
        currency: parsed.data.currency?.trim() || null,
        tag: parsed.data.tag?.trim() || null,
        providerField: "chat_gpt_products_element",
      });
    }
  }
  return products;
}
