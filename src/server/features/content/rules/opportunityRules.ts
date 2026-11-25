// Explainable opportunity rules. Every outcome names the rule that fired and
// the thresholds, so the evidence shown to the user is the actual reason.
// No composite score: each rule reads the Search Console numbers directly.

export const MIN_IMPRESSIONS = 100;
export const MIN_IMPRESSIONS_FOR_ANY_ACTION = 50;
export const TOP_POSITION_MAX = 3;
export const LOW_CTR_BELOW = 0.05;
export const STRIKING_POSITION_MIN = 4;
export const STRIKING_POSITION_MAX = 20;
export const INFORMATIONAL_PREFIXES = [
  "how",
  "what",
  "why",
  "which",
  "best",
  "guide",
  "vs",
  "is",
  "can",
  "does",
  "when",
  "where",
] as const;

export type OpportunityAction =
  | "new_article"
  | "refresh_existing_page"
  | "update_collection_page"
  | "improve_title_and_meta"
  | "create_page"
  | "improve_internal_links"
  | "technical_fix"
  // From AI citation gaps: work that is not a page on the site.
  | "earn_third_party_coverage"
  | "review_brand_information"
  | "no_action";

export type GscRow = {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type StoreCollection = { handle: string; title: string };

export type OpportunityDecision = {
  query: string;
  pageUrl: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  action: OpportunityAction;
  reason: string;
  matchedCollectionHandle: string | null;
};

const STOP_WORDS = new Set(["the", "a", "an", "for", "of", "and", "to", "in"]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function isInformationalQuery(query: string): boolean {
  const first = tokenize(query)[0] ?? "";
  return (INFORMATIONAL_PREFIXES as readonly string[]).includes(first);
}

export function pageKind(
  pageUrl: string,
): "product" | "collection" | "blog" | "other" {
  let path = pageUrl;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    // Treat a bare path as a path.
  }
  if (/\/products\//.test(path)) return "product";
  if (/\/collections\//.test(path)) return "collection";
  if (/\/blogs\//.test(path)) return "blog";
  return "other";
}

// A collection matches when every token of its title appears in the query.
function matchCollection(
  query: string,
  collections: StoreCollection[],
): StoreCollection | null {
  const queryTokens = new Set(tokenize(query));
  let best: StoreCollection | null = null;
  let bestSize = 0;
  for (const collection of collections) {
    const tokens = tokenize(collection.title);
    if (tokens.length === 0) continue;
    if (
      tokens.every((token) => queryTokens.has(token)) &&
      tokens.length > bestSize
    ) {
      best = collection;
      bestSize = tokens.length;
    }
  }
  return best;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function decideOpportunity(
  row: GscRow,
  collections: StoreCollection[],
): OpportunityDecision {
  const base = {
    query: row.query,
    pageUrl: row.page,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  };
  const kind = pageKind(row.page);
  const collection = matchCollection(row.query, collections);

  if (row.impressions < MIN_IMPRESSIONS_FOR_ANY_ACTION) {
    return {
      ...base,
      action: "no_action",
      matchedCollectionHandle: null,
      reason: `Only ${row.impressions} impressions in the window, below the ${MIN_IMPRESSIONS_FOR_ANY_ACTION} needed before any action is worth recommending.`,
    };
  }

  if (
    row.position <= TOP_POSITION_MAX &&
    row.ctr < LOW_CTR_BELOW &&
    row.impressions >= MIN_IMPRESSIONS
  ) {
    return {
      ...base,
      action: "improve_title_and_meta",
      matchedCollectionHandle: null,
      reason: `Average position ${fmt(row.position)} (top ${TOP_POSITION_MAX}) but CTR ${fmt(row.ctr * 100)}% is under ${LOW_CTR_BELOW * 100}% on ${row.impressions} impressions. The ranking is there; the snippet is not earning the click.`,
    };
  }

  if (
    collection &&
    !row.page.includes(`/collections/${collection.handle}`) &&
    row.impressions >= MIN_IMPRESSIONS
  ) {
    return {
      ...base,
      action: "update_collection_page",
      matchedCollectionHandle: collection.handle,
      reason: `The query contains every word of the collection "${collection.title}", but the page ranking is a ${kind} page at position ${fmt(row.position)}. Strengthening the collection page is likely a better fit than a new article.`,
    };
  }

  if (
    row.position >= STRIKING_POSITION_MIN &&
    row.position <= STRIKING_POSITION_MAX &&
    row.impressions >= MIN_IMPRESSIONS &&
    kind === "blog"
  ) {
    return {
      ...base,
      action: "refresh_existing_page",
      matchedCollectionHandle: null,
      reason: `An existing article ranks at average position ${fmt(row.position)} (between ${STRIKING_POSITION_MIN} and ${STRIKING_POSITION_MAX}) with ${row.impressions} impressions. Refreshing it is cheaper than writing a competing page for the same intent.`,
    };
  }

  if (
    row.impressions >= MIN_IMPRESSIONS &&
    isInformationalQuery(row.query) &&
    kind !== "blog"
  ) {
    return {
      ...base,
      action: "new_article",
      matchedCollectionHandle: null,
      reason: `Informational query ("${row.query}") with ${row.impressions} impressions, currently served by a ${kind} page at position ${fmt(row.position)}. No article from this store is ranking for it.`,
    };
  }

  return {
    ...base,
    action: "no_action",
    matchedCollectionHandle: null,
    reason: `No rule fired: position ${fmt(row.position)}, CTR ${fmt(row.ctr * 100)}%, ${row.impressions} impressions on a ${kind} page.`,
  };
}

// One decision per query: the row with the most impressions represents it, so a
// query ranking through several URLs is not recommended several times.
export function decideOpportunities(
  rows: GscRow[],
  collections: StoreCollection[],
): OpportunityDecision[] {
  const byQuery = new Map<string, GscRow>();
  for (const row of rows) {
    const key = row.query.trim().toLowerCase();
    const current = byQuery.get(key);
    if (!current || row.impressions > current.impressions) {
      byQuery.set(key, row);
    }
  }
  const decisions = [...byQuery.values()].map((row) =>
    decideOpportunity(row, collections),
  );
  decisions.sort((a, b) => b.impressions - a.impressions);
  return decisions;
}
