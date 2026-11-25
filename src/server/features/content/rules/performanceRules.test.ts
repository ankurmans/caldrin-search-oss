import { describe, expect, it } from "vitest";
import { assessPerformance } from "./performanceRules";

const now = new Date("2026-11-16T00:00:00Z");
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 86_400_000).toISOString();
const window = (
  over: Partial<{
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>,
) => ({
  clicks: 10,
  impressions: 500,
  ctr: 0.02,
  position: 3,
  ...over,
});

describe("assessPerformance", () => {
  it("says nothing about an article too new for Search Console to report", () => {
    expect(
      assessPerformance({
        publishedAt: daysAgo(3),
        now,
        current: null,
        previous: null,
      }),
    ).toEqual({ status: "too_early", suggestions: [] });
  });

  it("asks for an indexing check, not a rewrite, when an older article has no impressions", () => {
    const result = assessPerformance({
      publishedAt: daysAgo(20),
      now,
      current: null,
      previous: null,
    });
    expect(result.status).toBe("no_data");
    expect(result.suggestions.map((s) => s.action)).toEqual(["check_indexing"]);
  });

  it("flags low click rate and near-page-one position from the measured numbers", () => {
    const result = assessPerformance({
      publishedAt: daysAgo(30),
      now,
      current: window({ ctr: 0.005, position: 8 }),
      previous: null,
    });
    expect(result.suggestions.map((s) => s.action)).toEqual([
      "improve_title_and_meta",
      "expand_content",
      "improve_internal_links",
    ]);
  });

  it("flags a decline only when the article is old enough to have a prior window", () => {
    const current = window({ clicks: 3, ctr: 0.05, position: 2 });
    const previous = window({ clicks: 20 });
    expect(
      assessPerformance({ publishedAt: daysAgo(30), now, current, previous })
        .suggestions,
    ).toEqual([]);
    expect(
      assessPerformance({
        publishedAt: daysAgo(90),
        now,
        current,
        previous,
      }).suggestions.map((s) => s.action),
    ).toEqual(["review_for_decline"]);
  });
});
