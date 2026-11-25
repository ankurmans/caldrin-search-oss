import {
  MIN_IMPRESSIONS,
  pageKind,
  tokenize,
  type GscRow,
} from "@/server/features/content/rules/opportunityRules";
import type { StoreSnapshot } from "@/server/features/content/rules/storeTypes";
import type { EngineInputs, OpportunityCandidate } from "../types";
import { gscMetricEvidence } from "./evidence";
import { classifyIntent } from "./intentRules";
import { priorityFromImpressions } from "./priorityRules";

function coversQuery(title: string, queryTokens: string[]): boolean {
  const titleTokens = new Set(tokenize(title));
  return queryTokens.every((token) => titleTokens.has(token));
}

function storeHasPageFor(query: string, store: StoreSnapshot): boolean {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return true;
  const queryTokenSet = new Set(queryTokens);
  const collectionMatch = store.collections.some((c) => {
    const tokens = tokenize(c.title);
    return tokens.length > 0 && tokens.every((t) => queryTokenSet.has(t));
  });
  return (
    collectionMatch ||
    store.products.some((p) => coversQuery(p.title, queryTokens))
  );
}

// A commercial or transactional query with real demand, answered only by a
// non-commercial page, where the catalog has no collection or product that
// the query names. Needs the store snapshot: without it "missing" cannot be said.
export function commercialPageCandidates(
  inputs: EngineInputs,
  observedAt: string,
): OpportunityCandidate[] {
  const { gsc, store } = inputs;
  if (!gsc || !store) return [];
  const best = new Map<string, GscRow>();
  for (const row of gsc.rows) {
    const key = row.query.trim().toLowerCase();
    const current = best.get(key);
    if (!current || row.impressions > current.impressions) best.set(key, row);
  }
  const out: OpportunityCandidate[] = [];
  for (const row of best.values()) {
    if (row.impressions < MIN_IMPRESSIONS) continue;
    const kind = pageKind(row.page);
    if (kind === "product" || kind === "collection") continue;
    const intent = classifyIntent(row.query, {
      brandTerms: inputs.brandTerms,
      store,
    });
    if (intent !== "commercial" && intent !== "transactional") continue;
    if (storeHasPageFor(row.query, store)) continue;
    out.push({
      dedupeKey: `create_page::${row.query.trim().toLowerCase()}`,
      query: row.query,
      pageUrl: row.page,
      action: "create_page",
      reason: `${intent === "commercial" ? "Commercial" : "Transactional"} query "${row.query}" has ${row.impressions} impressions at position ${row.position.toFixed(1)}, answered by a ${kind} page. None of the store's ${store.collections.length} collections or ${store.products.length} products is named by the query, so there is no commercial page built for it.`,
      matchedCollectionHandle: null,
      dataSource: gsc.source,
      intent,
      ...priorityFromImpressions(row.impressions, "create_page"),
      observedAt,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      position: row.position,
      windowStart: gsc.windowStart,
      windowEnd: gsc.windowEnd,
      evidence: [
        ...gscMetricEvidence({
          source: gsc.source,
          row,
          windowStart: gsc.windowStart,
          windowEnd: gsc.windowEnd,
          observedAt,
        }),
        {
          source: "shopify",
          label: "Catalog checked",
          value: `${store.collections.length} collections and ${store.products.length} products, none named by the query`,
          observedAt,
        },
      ],
    });
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return out;
}
