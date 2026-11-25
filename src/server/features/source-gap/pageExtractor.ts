import type { ParsedPage } from "@/shared/source-gap";
import {
  commercialFacts,
  comparisonSignals,
  credentialsOn,
  firstHandEvidence,
  hasMethodology,
  pageKind,
  readJsonLd,
  reviewerOn,
  summarizeTables,
  toIso,
  visibleUpdate,
} from "./pageFacts";
import { clean, tokenizePage, type RawPage } from "./pageTokenizer";

const TEXT_CAP = 20_000;

function firstMeta(raw: RawPage, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw.meta.get(key);
    if (value) return value;
  }
  return undefined;
}

/**
 * Reads what a page says. Every field is observed text or markup; nothing is
 * scored here.
 */
export function extractPage(html: string, finalUrl: string): ParsedPage {
  const raw = tokenizePage(html, finalUrl);
  const visible = raw.text.split("\n").map(clean).filter(Boolean).join("\n");
  const ld = readJsonLd(raw.jsonLd);
  const tables = summarizeTables(raw.tables);
  const comparison = comparisonSignals(
    tables,
    [...raw.h1s, ...raw.h2s, ...raw.h3s],
    visible,
  );
  const title = clean(raw.title);
  const schemaTypes = [...new Set(ld.types)].slice(0, 15);
  const author =
    ld.authors[0] ?? raw.meta.get("author") ?? raw.authorHints[0] ?? null;
  const description = raw.meta.get("description");
  return {
    finalUrl,
    canonical: raw.canonical,
    title: title || null,
    metaDescription: description ? clean(description) : null,
    robotsMeta: raw.meta.get("robots") ?? null,
    hreflang: [...new Set(raw.hreflang)].slice(0, 30),
    h1s: raw.h1s,
    h2s: raw.h2s,
    h3s: raw.h3s,
    wordCount: visible ? visible.split(/\s+/).length : 0,
    text: visible.slice(0, TEXT_CAP),
    tables,
    listCount: raw.listCount,
    hasFaq:
      ld.faq ||
      raw.h2s.concat(raw.h3s).filter((h) => h.endsWith("?")).length >= 3,
    schemaTypes,
    internalLinkCount: raw.internalLinkCount,
    internalLinks: raw.internalLinks,
    externalLinks: raw.externalLinks,
    author: author ? clean(author).slice(0, 80) : null,
    reviewer: reviewerOn(visible),
    credentials: credentialsOn(visible),
    quoteCount: raw.quoteCount,
    publishedAt:
      ld.published ??
      toIso(firstMeta(raw, "article:published_time", "datepublished", "date")),
    modifiedAt:
      ld.modified ??
      toIso(
        firstMeta(
          raw,
          "article:modified_time",
          "og:updated_time",
          "datemodified",
        ),
      ) ??
      toIso(raw.times.at(-1)),
    visibleUpdated: visibleUpdate(visible),
    pageKind: pageKind(
      finalUrl,
      title,
      raw.h1s[0] ?? "",
      schemaTypes,
      Object.keys(comparison).length,
    ),
    commercial: commercialFacts(visible),
    comparison,
    firstHand: firstHandEvidence(visible),
    methodology: hasMethodology(visible),
    imageCount: raw.imageCount,
  };
}
