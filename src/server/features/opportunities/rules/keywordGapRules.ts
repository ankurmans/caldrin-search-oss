import { tokenize } from "@/server/features/content/rules/opportunityRules";
import type {
  CompetitorKeyword,
  EngineInputs,
  OpportunityCandidate,
} from "../types";
import { classifyIntent } from "./intentRules";
import {
  MAX_COMPETITOR_POSITION,
  MIN_GAP_SEARCH_VOLUME,
} from "./keywordGapPlan";
import { priorityFromSearchVolume } from "./priorityRules";

const MAX_GAPS = 50;

// Competitor keywords the project has no Search Console row for. A keyword a
// competitor ranks for, with real monthly volume, that never appears in the
// site's own query data in the window is a gap. Needs live Search Console data:
// against simulated rows the claim would be made against fixtures.
export function keywordGapCandidates(
  inputs: EngineInputs,
  provider: { keywords: CompetitorKeyword[]; observedAt: string },
  observedAt: string,
): OpportunityCandidate[] {
  const { gsc, store } = inputs;
  if (!gsc || gsc.source !== "gsc") return [];
  const known = new Set(gsc.rows.map((r) => r.query.trim().toLowerCase()));
  const best = new Map<string, CompetitorKeyword>();
  for (const item of provider.keywords) {
    const key = item.keyword.trim().toLowerCase();
    if (
      known.has(key) ||
      item.competitorPosition > MAX_COMPETITOR_POSITION ||
      item.searchVolume === null ||
      item.searchVolume < MIN_GAP_SEARCH_VOLUME
    ) {
      continue;
    }
    const current = best.get(key);
    if (!current || item.competitorPosition < current.competitorPosition) {
      best.set(key, item);
    }
  }
  const out: OpportunityCandidate[] = [];
  const ranked = [...best.values()];
  ranked.sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0));
  for (const item of ranked.slice(0, MAX_GAPS)) {
    const intent = classifyIntent(item.keyword, {
      brandTerms: inputs.brandTerms,
      store,
    });
    if (intent === "navigational") continue;
    const queryTokens = new Set(tokenize(item.keyword));
    const collection = store?.collections.find((c) => {
      const tokens = tokenize(c.title);
      return tokens.length > 0 && tokens.every((t) => queryTokens.has(t));
    });
    const action = collection
      ? "update_collection_page"
      : intent === "commercial" || intent === "transactional"
        ? "create_page"
        : "new_article";
    const volume = item.searchVolume;
    out.push({
      dedupeKey: `gap::${item.keyword.trim().toLowerCase()}`,
      query: item.keyword,
      pageUrl: null,
      action,
      reason: `${item.competitorDomain} ranks at position ${item.competitorPosition} for "${item.keyword}" (${volume} monthly searches), and this site has no Search Console row for it in ${gsc.windowStart} to ${gsc.windowEnd}.${collection ? ` The query contains every word of the "${collection.title}" collection.` : ""}`,
      matchedCollectionHandle: collection?.handle ?? null,
      dataSource: "competitor",
      intent,
      ...priorityFromSearchVolume({
        searchVolume: volume,
        competitorPosition: item.competitorPosition,
        competitorDomain: item.competitorDomain,
      }),
      // The row is seen as of this run; the evidence below keeps the date the
      // provider data was read.
      observedAt,
      impressions: 0,
      clicks: 0,
      ctr: 0,
      position: 0,
      windowStart: gsc.windowStart,
      windowEnd: gsc.windowEnd,
      evidence: [
        {
          source: "dataforseo",
          label: "Competitor ranking",
          value: `${item.competitorDomain} at position ${item.competitorPosition}`,
          url: item.competitorUrl,
          observedAt: provider.observedAt,
        },
        {
          source: "dataforseo",
          label: "Monthly search volume",
          value: `${volume}`,
          observedAt: provider.observedAt,
        },
        ...(item.keywordDifficulty === null
          ? []
          : [
              {
                source: "dataforseo",
                label: "Keyword difficulty (as reported by DataForSEO)",
                value: `${item.keywordDifficulty}`,
                observedAt: provider.observedAt,
              },
            ]),
        {
          source: gsc.source,
          label: "Own Search Console rows for this query",
          value: `0 in ${gsc.windowStart} to ${gsc.windowEnd}`,
          observedAt,
        },
      ],
    });
  }
  return out;
}
