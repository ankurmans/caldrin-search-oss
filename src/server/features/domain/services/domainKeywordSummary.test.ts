import { describe, expect, it } from "vitest";
import { summarizeKeywordSample } from "@/server/features/domain/services/domainKeywordSummary";
import { summarizePageFolders } from "@/server/features/domain/services/domainPagesSummary";
import { mapKeywordItem } from "@/server/features/domain/services/domainKeywordMapper";

const keyword = (overrides: Record<string, unknown>) =>
  ({
    keyword: "x",
    position: 1,
    previousPosition: null,
    change: null,
    searchVolume: null,
    traffic: 10,
    cpc: null,
    url: null,
    relativeUrl: null,
    keywordDifficulty: null,
    intent: null,
    serpFeatures: [],
    monthlySearches: [],
    serpCheckedAt: null,
    previousSerpCheckedAt: null,
    ...overrides,
  }) as Parameters<typeof summarizeKeywordSample>[0][number];

describe("summarizeKeywordSample", () => {
  it("counts intent, name matches and SERP features without double counting", () => {
    const summary = summarizeKeywordSample(
      [
        keyword({
          keyword: "Lumacreative pricing",
          intent: "commercial",
          traffic: 30,
          serpFeatures: ["images", "images"],
        }),
        keyword({ keyword: "how to light a set", intent: "informational" }),
        keyword({ keyword: "stage lights" }),
      ],
      "lumacreative.com",
    );

    expect(summary.intents["commercial"]).toEqual({ keywords: 1, traffic: 30 });
    expect(summary.intents["unclassified"]?.keywords).toBe(1);
    expect(summary.nameMatch?.matching).toEqual({ keywords: 1, traffic: 30 });
    expect(summary.nameMatch?.other.keywords).toBe(2);
    expect(summary.serpFeatures).toEqual([{ feature: "images", keywords: 1 }]);
  });

  it("skips the name match when the name is too short to mean a brand", () => {
    expect(
      summarizeKeywordSample([keyword({})], "ibm.com").nameMatch,
    ).toBeNull();
  });
});

const page = (relativePath: string | null, organicTraffic = 1) => ({
  relativePath,
  organicTraffic,
  keywords: 1,
});

describe("summarizePageFolders", () => {
  const byFolder = (paths: Array<string | null>) =>
    Object.fromEntries(
      summarizePageFolders(paths.map((path) => page(path))).map((row) => [
        row.folder,
        row.pages,
      ]),
    );

  it("keeps the home page, root-level pages, subfolders and unknown URLs apart", () => {
    expect(
      byFolder([
        "/",
        "/?utm_source=gmb",
        "/scholarships/",
        "/pricing",
        "/film/rivian/",
        "/film/pact/",
        "/blog/a?x=1#top",
        null,
        "no-slash",
      ]),
    ).toEqual({
      "(home page)": 2,
      "(root-level pages)": 2,
      "/film/": 2,
      "/blog/": 1,
      "(unknown URL)": 2,
    });
  });

  it("sums traffic per folder and puts the busiest first", () => {
    expect(
      summarizePageFolders([
        page("/blog/a", 5),
        page("/blog/b/c", 7),
        page("/pricing", 20),
      ]),
    ).toEqual([
      { folder: "(root-level pages)", pages: 1, traffic: 20 },
      { folder: "/blog/", pages: 2, traffic: 12 },
    ]);
  });
});

describe("mapKeywordItem", () => {
  it("reads rank change, oldest-first monthly volumes and drops the organic feature", () => {
    const row = mapKeywordItem({
      keyword_data: {
        keyword: "k",
        keyword_info: {
          monthly_searches: [
            { year: 2026, month: 10, search_volume: 20 },
            { year: 2026, month: 9, search_volume: 10 },
          ],
        },
        search_intent_info: { main_intent: "informational" },
        serp_info: {
          serp_item_types: ["organic", "people_also_ask"],
          last_updated_time: "2026-11-07 07:06:24 +00:00",
        },
      },
      ranked_serp_element: {
        serp_item: {
          rank_absolute: 4,
          rank_changes: { previous_rank_absolute: 7, is_up: true },
        },
      },
    });

    expect(row).toMatchObject({
      position: 4,
      previousPosition: 7,
      change: "up",
      intent: "informational",
      serpFeatures: ["people_also_ask"],
      monthlySearches: [
        { month: "2026-09", volume: 10 },
        { month: "2026-10", volume: 20 },
      ],
      serpCheckedAt: "2026-11-07",
    });
  });
});
