import { tokenize } from "@/server/features/content/rules/opportunityRules";
import type { StoreArticle } from "@/server/features/content/rules/storeTypes";
import type {
  EngineInputs,
  EvidenceInput,
  OpportunityCandidate,
} from "../types";
import { pct } from "./evidence";
import {
  priorityFromImpressions,
  priorityWithoutDemandData,
} from "./priorityRules";

type CollectionDemand = {
  handle: string;
  title: string;
  pageUrl: string | null;
  clicks: number;
  impressions: number;
  position: number;
};

export function articleCovers(article: StoreArticle, title: string): boolean {
  const articleTokens = new Set(tokenize(article.title));
  const wanted = tokenize(title);
  return wanted.length > 0 && wanted.every((t) => articleTokens.has(t));
}

// Search Console numbers for each collection page, summed across its queries.
export function collectionDemand(inputs: EngineInputs): CollectionDemand[] {
  const store = inputs.store;
  if (!store) return [];
  return store.collections.map((collection) => {
    const needle = `/collections/${collection.handle}`;
    let clicks = 0;
    let impressions = 0;
    let weighted = 0;
    let pageUrl: string | null = null;
    for (const row of inputs.gsc?.rows ?? []) {
      if (!row.page.includes(needle)) continue;
      pageUrl ??= row.page;
      clicks += row.clicks;
      impressions += row.impressions;
      weighted += row.position * row.impressions;
    }
    return {
      ...collection,
      pageUrl,
      clicks,
      impressions,
      position: impressions > 0 ? weighted / impressions : 0,
    };
  });
}

// A collection with no article in the store written around its name. With
// Search Console numbers for the collection page the priority comes from them;
// without, it is low and says so.
export function supportContentCandidates(
  inputs: EngineInputs,
  observedAt: string,
): OpportunityCandidate[] {
  const store = inputs.store;
  if (!store) return [];
  const gsc = inputs.gsc;
  const day = observedAt.slice(0, 10);
  const out: OpportunityCandidate[] = [];
  for (const demand of collectionDemand(inputs)) {
    if (store.articles.some((a) => articleCovers(a, demand.title))) continue;
    const hasDemand = gsc && demand.impressions > 0;
    const evidence: EvidenceInput[] = [
      {
        source: "shopify",
        label: "Collection",
        value: demand.title,
        url: `/collections/${demand.handle}`,
        observedAt,
      },
      {
        source: "shopify",
        label: "Articles checked",
        value: `${store.articles.length} in the store, none with every word of "${demand.title}" in its title`,
        observedAt,
      },
    ];
    if (hasDemand && gsc) {
      const base = { source: gsc.source, url: demand.pageUrl, observedAt };
      evidence.push(
        {
          ...base,
          label: "Collection page impressions",
          value: `${demand.impressions}`,
        },
        { ...base, label: "Collection page clicks", value: `${demand.clicks}` },
        {
          ...base,
          label: "Collection page CTR",
          value: pct(demand.clicks / demand.impressions),
        },
        {
          ...base,
          label: "Collection page average position",
          value: demand.position.toFixed(1),
        },
        {
          ...base,
          label: "Window",
          value: `${gsc.windowStart} to ${gsc.windowEnd}`,
        },
      );
    }
    out.push({
      dedupeKey: `support::${demand.handle}`,
      query: demand.title,
      pageUrl: demand.pageUrl,
      action: "new_article",
      reason: hasDemand
        ? `The "${demand.title}" collection page has ${demand.impressions} impressions at position ${demand.position.toFixed(1)}, and none of the store's ${store.articles.length} articles is written around it. A supporting article could link to the collection.`
        : `No article in the store is written around the "${demand.title}" collection. A supporting article could link to it.`,
      matchedCollectionHandle: demand.handle,
      dataSource:
        hasDemand && gsc
          ? gsc.source
          : inputs.storeMode === "simulated"
            ? "simulated"
            : "shopify",
      intent: null,
      ...(hasDemand
        ? priorityFromImpressions(demand.impressions, "new_article")
        : priorityWithoutDemandData(
            `Collection "${demand.title}" has no supporting article`,
            gsc !== null,
          )),
      observedAt,
      impressions: hasDemand ? demand.impressions : 0,
      clicks: hasDemand ? demand.clicks : 0,
      ctr:
        hasDemand && demand.impressions > 0
          ? demand.clicks / demand.impressions
          : 0,
      position: hasDemand ? demand.position : 0,
      windowStart: hasDemand && gsc ? gsc.windowStart : day,
      windowEnd: hasDemand && gsc ? gsc.windowEnd : day,
      evidence,
    });
  }
  return out;
}
