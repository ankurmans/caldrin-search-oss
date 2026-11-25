import { sortBy } from "remeda";
import { type DomainRankedKeywordItem } from "@/server/lib/dataforseo";
import { toRelativePath } from "@/server/lib/domainUtils";

const MONTHLY_HISTORY_MONTHS = 12;

/** `2026-11-07 07:06:24 +00:00` to `2026-11-07`. */
function toDate(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

type RankChanges = NonNullable<
  NonNullable<
    NonNullable<DomainRankedKeywordItem["ranked_serp_element"]>["serp_item"]
  >["rank_changes"]
>;

function mapChange(
  changes: RankChanges | null | undefined,
): "new" | "up" | "down" | "same" | null {
  if (!changes) return null;
  if (changes.is_new) return "new";
  if (changes.is_up) return "up";
  if (changes.is_down) return "down";
  return "same";
}

type MonthlySearches = NonNullable<
  NonNullable<
    NonNullable<DomainRankedKeywordItem["keyword_data"]>["keyword_info"]
  >["monthly_searches"]
>;

/** The provider lists newest first; callers want oldest first. */
function mapMonthlySearches(entries: MonthlySearches | null | undefined) {
  const newestFirst = (entries ?? [])
    .flatMap((entry) =>
      entry.year != null && entry.month != null && entry.search_volume != null
        ? [
            {
              month: `${entry.year}-${String(entry.month).padStart(2, "0")}`,
              volume: Math.round(entry.search_volume),
            },
          ]
        : [],
    )
    .slice(0, MONTHLY_HISTORY_MONTHS);
  return sortBy(newestFirst, (entry) => entry.month);
}

type RankedElement = NonNullable<
  DomainRankedKeywordItem["ranked_serp_element"]
>;
type KeywordData = NonNullable<DomainRankedKeywordItem["keyword_data"]>;

function roundOrNull(value: number | null | undefined) {
  return value != null ? Math.round(value) : null;
}

function mapRanking(element: RankedElement | null | undefined) {
  const serpItem = element?.serp_item;
  const url = serpItem?.url ?? element?.url ?? null;
  const changes = serpItem?.rank_changes;
  return {
    url,
    relativeUrl:
      serpItem?.relative_url ??
      element?.relative_url ??
      (url ? toRelativePath(url) : null),
    position: roundOrNull(serpItem?.rank_absolute ?? element?.rank_absolute),
    previousPosition: roundOrNull(changes?.previous_rank_absolute),
    change: mapChange(changes),
    traffic: serpItem?.etv ?? element?.etv ?? null,
  };
}

function mapKeywordMetrics(keywordData: KeywordData | null | undefined) {
  const info = keywordData?.keyword_info;
  return {
    searchVolume: roundOrNull(info?.search_volume),
    cpc: info?.cpc ?? null,
    keywordDifficulty: roundOrNull(
      keywordData?.keyword_properties?.keyword_difficulty ??
        info?.keyword_difficulty,
    ),
    monthlySearches: mapMonthlySearches(info?.monthly_searches),
  };
}

function mapSerpInfo(
  keywordData: KeywordData | null | undefined,
  element: RankedElement | null | undefined,
) {
  const serpInfo = keywordData?.serp_info;
  return {
    intent: keywordData?.search_intent_info?.main_intent ?? null,
    serpFeatures: (serpInfo?.serp_item_types ?? []).filter(
      // The ranking result itself is not a feature of the page around it.
      (type) => type !== "organic",
    ),
    serpCheckedAt: toDate(
      element?.last_updated_time ?? serpInfo?.last_updated_time,
    ),
    previousSerpCheckedAt: toDate(
      element?.previous_updated_time ?? serpInfo?.previous_updated_time,
    ),
  };
}

export function mapKeywordItem(item: DomainRankedKeywordItem) {
  const keyword = item.keyword_data?.keyword ?? item.keyword;
  if (!keyword) return null;

  return {
    keyword,
    ...mapRanking(item.ranked_serp_element),
    ...mapKeywordMetrics(item.keyword_data),
    ...mapSerpInfo(item.keyword_data, item.ranked_serp_element),
  };
}
