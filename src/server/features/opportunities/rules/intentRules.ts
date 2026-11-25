import { tokenize } from "@/server/features/content/rules/opportunityRules";
import type { StoreSnapshot } from "@/server/features/content/rules/storeTypes";
import type { OpportunityIntent } from "../types";

// Explicit word lists, checked in order: brand, transactional, commercial,
// informational. A query none of them fits has no intent (null), never a guess.
const TRANSACTIONAL_WORDS = [
  "buy",
  "purchase",
  "order",
  "shop",
  "price",
  "prices",
  "cheap",
  "cheapest",
  "coupon",
  "discount",
  "deal",
  "deals",
  "sale",
  "subscription",
] as const;

const COMMERCIAL_WORDS = [
  "best",
  "top",
  "review",
  "reviews",
  "vs",
  "versus",
  "compare",
  "comparison",
  "alternative",
  "alternatives",
  "recommended",
] as const;

const INFORMATIONAL_WORDS = [
  "how",
  "what",
  "why",
  "which",
  "when",
  "where",
  "guide",
  "tutorial",
  "tips",
  "ideas",
  "ratio",
  "meaning",
  "difference",
  "can",
  "does",
  "is",
] as const;

function hasAny(tokens: string[], words: readonly string[]): boolean {
  return tokens.some((token) => words.includes(token));
}

// A query that is just a product or collection name (every word of the title)
// is someone looking for that thing to buy.
function namesStoreItem(tokens: Set<string>, store: StoreSnapshot): boolean {
  const titles = [
    ...store.products.map((p) => p.title),
    ...store.collections.map((c) => c.title),
  ];
  return titles.some((title) => {
    const titleTokens = tokenize(title);
    return (
      titleTokens.length > 0 && titleTokens.every((token) => tokens.has(token))
    );
  });
}

export function classifyIntent(
  query: string,
  context: { brandTerms: string[]; store: StoreSnapshot | null },
): OpportunityIntent | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  const queryTokens = new Set(tokens);
  const namesBrand = context.brandTerms.some((term) => {
    const brandTokens = tokenize(term);
    return (
      brandTokens.length > 0 && brandTokens.every((t) => queryTokens.has(t))
    );
  });
  if (namesBrand) return "navigational";
  if (hasAny(tokens, TRANSACTIONAL_WORDS)) return "transactional";
  if (hasAny(tokens, COMMERCIAL_WORDS)) return "commercial";
  if (hasAny(tokens, INFORMATIONAL_WORDS)) return "informational";
  if (context.store && namesStoreItem(new Set(tokens), context.store)) {
    return "commercial";
  }
  return null;
}
