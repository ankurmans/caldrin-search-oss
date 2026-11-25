// Reads a published article's Search Console numbers and says what, if
// anything, deserves a human look. It never claims the article caused a change:
// it reports the observation and the rule that fired.

export const MIN_AGE_DAYS = 7;
export const COMPARE_AFTER_DAYS = 56;
export const MIN_IMPRESSIONS_FOR_SUGGESTION = 100;
export const LOW_CTR = 0.02;
export const DECLINE_RATIO = 0.6;

export type Window = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type PerformanceStatus = "too_early" | "no_data" | "measured";

export type RefreshSuggestion = {
  action:
    | "improve_title_and_meta"
    | "expand_content"
    | "improve_internal_links"
    | "check_indexing"
    | "review_for_decline";
  reason: string;
};

export function assessPerformance(input: {
  publishedAt: string | null;
  now: Date;
  current: Window | null;
  previous: Window | null;
}): { status: PerformanceStatus; suggestions: RefreshSuggestion[] } {
  const publishedMs = input.publishedAt
    ? new Date(input.publishedAt).getTime()
    : Number.NaN;
  const ageDays = Number.isNaN(publishedMs)
    ? 0
    : (input.now.getTime() - publishedMs) / 86_400_000;

  if (ageDays < MIN_AGE_DAYS) return { status: "too_early", suggestions: [] };
  if (!input.current || input.current.impressions === 0) {
    return {
      status: "no_data",
      suggestions: [
        {
          action: "check_indexing",
          reason: `No Search Console impressions after ${Math.floor(ageDays)} days. Check that the page is indexed and linked from the site.`,
        },
      ],
    };
  }

  const { impressions, ctr, position, clicks } = input.current;
  const suggestions: RefreshSuggestion[] = [];
  if (impressions >= MIN_IMPRESSIONS_FOR_SUGGESTION && ctr < LOW_CTR) {
    suggestions.push({
      action: "improve_title_and_meta",
      reason: `${impressions} impressions but a ${(ctr * 100).toFixed(1)}% click rate (below ${LOW_CTR * 100}%).`,
    });
  }
  if (
    impressions >= MIN_IMPRESSIONS_FOR_SUGGESTION &&
    position >= 4 &&
    position <= 20
  ) {
    suggestions.push({
      action: "expand_content",
      reason: `Average position ${position.toFixed(1)}: close enough to page one to justify a content review.`,
    });
    suggestions.push({
      action: "improve_internal_links",
      reason: "Pages in this range often gain from more internal links.",
    });
  }
  if (
    ageDays >= COMPARE_AFTER_DAYS &&
    input.previous &&
    input.previous.clicks > 0 &&
    clicks < input.previous.clicks * DECLINE_RATIO
  ) {
    suggestions.push({
      action: "review_for_decline",
      reason: `Clicks fell from ${input.previous.clicks} to ${clicks} against the previous 28 days. Check for outdated facts or new competitors.`,
    });
  }
  return { status: "measured", suggestions };
}
