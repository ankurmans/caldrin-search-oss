import { sortBy } from "remeda";
import { tokenize, isInformationalQuery } from "./opportunityRules";
import type { OpportunityDecision } from "./opportunityRules";
import type { StoreArticle, StoreProduct, StoreSnapshot } from "./storeTypes";

export type ContentBrief = {
  title: string;
  searchIntent: string;
  markdown: string;
  products: StoreProduct[];
  // Existing blog posts on the same subject, for the draft to link to.
  relatedArticles: StoreArticle[];
  collectionHandles: string[];
  // Facts the brief needs from the merchant that the store data does not hold.
  gaps: string[];
};

const MAX_PRODUCTS = 4;
const MAX_RELATED_ARTICLES = 4;

function titleCase(text: string): string {
  return text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// Products whose title or description shares a word with the query, available
// ones first. Unavailable products are never recommended as available.
export function matchProducts(
  query: string,
  products: StoreProduct[],
): StoreProduct[] {
  const queryTokens = new Set(tokenize(query));
  const scored = products
    .map((product) => {
      const hits = tokenize(`${product.title} ${product.description}`).filter(
        (token) => queryTokens.has(token),
      );
      return { product, hits: new Set(hits).size };
    })
    .filter((entry) => entry.hits > 0 && entry.product.available);
  scored.sort((a, b) => b.hits - a.hits);
  return scored.slice(0, MAX_PRODUCTS).map((entry) => entry.product);
}

// Blog posts whose title shares a word with the query, best match first. The
// page being rewritten is left out so a draft never links to itself.
function matchArticles(
  query: string,
  articles: StoreArticle[],
  ownPageUrl: string,
): StoreArticle[] {
  const queryTokens = new Set(tokenize(query));
  const scored = articles
    .filter((a) => !ownPageUrl.endsWith(`/blogs/${a.blogHandle}/${a.handle}`))
    .map((article) => ({
      article,
      hits: new Set(tokenize(article.title).filter((t) => queryTokens.has(t)))
        .size,
    }))
    .filter((entry) => entry.hits > 0);
  return sortBy(scored, [(entry) => entry.hits, "desc"])
    .slice(0, MAX_RELATED_ARTICLES)
    .map((entry) => entry.article);
}

export function buildBrief(
  decision: OpportunityDecision,
  store: StoreSnapshot,
): ContentBrief {
  const products = matchProducts(decision.query, store.products);
  const relatedArticles = matchArticles(
    decision.query,
    store.articles,
    decision.pageUrl,
  );
  const collection = store.collections.find(
    (c) => c.handle === decision.matchedCollectionHandle,
  );
  const informational = isInformationalQuery(decision.query);
  const searchIntent = informational
    ? "Informational with commercial follow-up: the searcher wants an answer, then options."
    : "Commercial investigation: the searcher is comparing what to buy.";
  const title = titleCase(decision.query);

  const gaps: string[] = [
    "First-hand testing, customer feedback or expert quotes: none supplied, so the draft contains none.",
    "Statistics or research findings: none supplied, so the draft contains none.",
  ];
  if (products.length === 0) {
    gaps.push(
      `No available product in this store matches "${decision.query}". Add the product facts the article should rely on.`,
    );
  }

  const markdown = [
    `# Brief: ${title}`,
    "",
    `**Opportunity:** ${decision.query}`,
    `**Recommended action:** ${decision.action.replaceAll("_", " ")}`,
    `**Why this exists:** ${decision.reason}`,
    `**Evidence window:** ${decision.impressions} impressions, ${decision.clicks} clicks, CTR ${(decision.ctr * 100).toFixed(1)}%, position ${decision.position.toFixed(1)}`,
    `**Search intent:** ${searchIntent}`,
    "",
    "## Store context",
    products.length
      ? products
          .map((p) => `- Product: ${p.title} (/products/${p.handle})`)
          .join("\n")
      : "- No matching available products.",
    ...(relatedArticles.length
      ? relatedArticles.map(
          (a) =>
            `- Related guide: ${a.title} (/blogs/${a.blogHandle}/${a.handle})`,
        )
      : []),
    collection
      ? `- Collection: ${collection.title} (/collections/${collection.handle})`
      : "- No matching collection.",
    "",
    "## Gaps the merchant must fill",
    gaps.map((g) => `- ${g}`).join("\n"),
  ].join("\n");

  return {
    title,
    searchIntent,
    markdown,
    products,
    relatedArticles,
    collectionHandles: collection ? [collection.handle] : [],
    gaps,
  };
}
