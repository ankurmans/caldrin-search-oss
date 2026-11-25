import type { OpportunityAction } from "@/server/features/content/rules/opportunityRules";
import type { StoreSnapshot } from "@/server/features/content/rules/storeTypes";
import { tokenize } from "@/server/features/content/rules/opportunityRules";
import { classifyIntent } from "@/server/features/opportunities/rules/intentRules";
import { priorityFromSearchVolume } from "@/server/features/opportunities/rules/priorityRules";
import type { OpportunityCandidate } from "@/server/features/opportunities/types";
import { likelyPageType, type PageType } from "./pageType";

export type GapRowForAction = {
  keyword: string;
  kind: "missing" | "outranked";
  searchVolume: number | null;
  keywordDifficulty: number | null;
  bestPosition: number;
  bestDomain: string;
  bestUrl: string | null;
  competitorCount: number;
  targetPosition: number | null;
  targetUrl: string | null;
  observedAt: string;
};

type GapActionContext = {
  locationCode: number;
  brandTerms: string[];
  store: StoreSnapshot | null;
  // The page on this site the person chose for the keyword, if any.
  targetPageUrl: string | null;
};

// Pages whose winners are commercial pages. A blog post would answer a
// different search than the one these pages win, so no article is recommended
// for them.
const COMMERCIAL_PAGE_TYPES: ReadonlySet<PageType> = new Set([
  "collection",
  "product",
  "service",
  "pricing",
  "comparison",
  "homepage",
]);

type GapActionResult =
  | { ok: true; candidate: OpportunityCandidate }
  | { ok: false; reason: string };

function actionFor(
  row: GapRowForAction,
  ctx: GapActionContext,
  intent: ReturnType<typeof classifyIntent>,
  winnerType: PageType | null,
): { action: OpportunityAction; collection: string | null } {
  const queryTokens = new Set(tokenize(row.keyword));
  const collection =
    ctx.store?.collections.find((c) => {
      const tokens = tokenize(c.title);
      return tokens.length > 0 && tokens.every((t) => queryTokens.has(t));
    })?.handle ?? null;
  if (collection) return { action: "update_collection_page", collection };
  const existing = ctx.targetPageUrl ?? row.targetUrl;
  if (existing) return { action: "refresh_existing_page", collection: null };
  const commercial =
    intent === "commercial" ||
    intent === "transactional" ||
    (winnerType !== null && COMMERCIAL_PAGE_TYPES.has(winnerType));
  return {
    action: commercial ? "create_page" : "new_article",
    collection: null,
  };
}

// Turns one keyword gap row into an opportunity the existing engine stores and
// the Content Studio can brief. Branded keywords are refused: a competitor's
// brand name is not a gap. Product, collection and service intent never gets a
// blog recommendation.
export function candidateFromGapRow(
  row: GapRowForAction,
  ctx: GapActionContext,
): GapActionResult {
  const intent = classifyIntent(row.keyword, {
    brandTerms: ctx.brandTerms,
    store: ctx.store,
  });
  if (intent === "navigational") {
    return {
      ok: false,
      reason: `"${row.keyword}" names this brand, so it is not a gap.`,
    };
  }
  const winnerType = likelyPageType(row.bestUrl);
  const { action, collection } = actionFor(row, ctx, intent, winnerType);
  const pageUrl = ctx.targetPageUrl ?? row.targetUrl;
  const volume = row.searchVolume;
  const position =
    row.kind === "outranked" && row.targetPosition !== null
      ? ` This site ranks at position ${row.targetPosition}.`
      : " This site has no ranking for it in the provider's data.";
  const others =
    row.competitorCount > 1
      ? ` ${row.competitorCount - 1} other compared competitor${row.competitorCount === 2 ? "" : "s"} also rank for it.`
      : "";
  return {
    ok: true,
    candidate: {
      dedupeKey: `explorer_gap::${ctx.locationCode}::${row.keyword}`,
      query: row.keyword,
      pageUrl,
      action,
      reason: `${row.bestDomain} ranks at position ${row.bestPosition} for "${row.keyword}"${volume === null ? "" : ` (${volume} monthly searches)`}.${position}${others}`,
      matchedCollectionHandle: collection,
      dataSource: "competitor",
      intent,
      ...priorityFromSearchVolume({
        searchVolume: volume,
        competitorPosition: row.bestPosition,
        competitorDomain: row.bestDomain,
      }),
      observedAt: row.observedAt,
      impressions: 0,
      clicks: 0,
      ctr: 0,
      position: row.targetPosition ?? 0,
      windowStart: row.observedAt.slice(0, 10),
      windowEnd: row.observedAt.slice(0, 10),
      evidence: [
        {
          source: "dataforseo",
          label: "Competitor ranking",
          value: `${row.bestDomain} at position ${row.bestPosition}`,
          url: row.bestUrl,
          observedAt: row.observedAt,
        },
        ...(volume === null
          ? []
          : [
              {
                source: "dataforseo",
                label: "Monthly search volume (estimate)",
                value: `${volume}`,
                observedAt: row.observedAt,
              },
            ]),
        ...(row.keywordDifficulty === null
          ? []
          : [
              {
                source: "dataforseo",
                label: "Keyword difficulty (as reported by DataForSEO)",
                value: `${row.keywordDifficulty}`,
                observedAt: row.observedAt,
              },
            ]),
        {
          source: "dataforseo",
          label: "Own ranking",
          value:
            row.targetPosition === null
              ? "Not ranking in the provider's data"
              : `Position ${row.targetPosition}`,
          url: row.targetUrl,
          observedAt: row.observedAt,
        },
      ],
    },
  };
}
