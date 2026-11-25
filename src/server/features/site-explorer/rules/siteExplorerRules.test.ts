import { describe, expect, it } from "vitest";
import type { DomainIntersectionItem } from "@/server/lib/dataforseo/labs";
import { candidateFromGapRow, type GapRowForAction } from "./gapAction";
import { mergeGapReads, normaliseDomain, providerDate } from "./gapMerge";
import { likelyPageType } from "./pageType";

const RUN_AT = "2026-11-19T10:00:00.000Z";

function item(input: {
  keyword: string;
  rank: number;
  url?: string;
  volume?: number | null;
  kd?: number | null;
  targetRank?: number;
}): DomainIntersectionItem {
  return {
    keyword_data: {
      keyword: input.keyword,
      keyword_info: {
        search_volume: input.volume === undefined ? 100 : input.volume,
      },
      keyword_properties:
        input.kd === undefined ? null : { keyword_difficulty: input.kd },
    },
    first_domain_serp_element: { rank_group: input.rank, url: input.url },
    second_domain_serp_element:
      input.targetRank === undefined
        ? null
        : { rank_group: input.targetRank, url: "https://me.test/page" },
  };
}

describe("normaliseDomain", () => {
  it("reduces URLs to a bare host and rejects non-domains", () => {
    expect(normaliseDomain("https://www.Example.com/path?x=1")).toBe(
      "example.com",
    );
    expect(normaliseDomain("blog.example.co.uk")).toBe("blog.example.co.uk");
    expect(normaliseDomain("not a domain")).toBeNull();
    expect(normaliseDomain("localhost")).toBeNull();
    expect(normaliseDomain("rival.por")).toBeNull();
    expect(normaliseDomain("")).toBeNull();
  });
});

describe("mergeGapReads", () => {
  it("merges the same keyword across competitors and keeps the best position", () => {
    const rows = mergeGapReads(
      [
        {
          competitorDomain: "a.test",
          kind: "missing",
          items: [item({ keyword: "Rope Swing", rank: 6, volume: 500 })],
        },
        {
          competitorDomain: "b.test",
          kind: "missing",
          items: [
            item({ keyword: "rope swing", rank: 2, volume: null, kd: 31 }),
            item({ keyword: "rope swing", rank: 9 }),
          ],
        },
      ],
      RUN_AT,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      keyword: "rope swing",
      kind: "missing",
      competitorCount: 2,
      bestPosition: 2,
      bestDomain: "b.test",
      // The first read had no difficulty; the second supplied it. Volume from
      // the first read is kept rather than overwritten by a missing value.
      searchVolume: 500,
      keywordDifficulty: 31,
    });
  });

  it("leaves missing values null and falls back to the run time", () => {
    const [row] = mergeGapReads(
      [
        {
          competitorDomain: "a.test",
          kind: "missing",
          items: [item({ keyword: "x", rank: 4, volume: null })],
        },
      ],
      RUN_AT,
    );
    expect(row).toMatchObject({
      searchVolume: null,
      keywordDifficulty: null,
      cpc: null,
      observedAt: RUN_AT,
    });
  });

  it("keeps outranked rows only where the competitor is ahead", () => {
    const rows = mergeGapReads(
      [
        {
          competitorDomain: "a.test",
          kind: "outranked",
          items: [
            item({ keyword: "ahead", rank: 2, targetRank: 8 }),
            item({ keyword: "behind", rank: 9, targetRank: 3 }),
          ],
        },
      ],
      RUN_AT,
    );
    expect(rows.map((r) => r.keyword)).toEqual(["ahead"]);
    expect(rows[0]).toMatchObject({ kind: "outranked", targetPosition: 8 });
  });

  it("skips items with no keyword or no position", () => {
    const rows = mergeGapReads(
      [
        {
          competitorDomain: "a.test",
          kind: "missing",
          items: [
            {
              keyword_data: null,
              first_domain_serp_element: { rank_group: 1 },
            },
            item({ keyword: "ok", rank: 5 }),
            {
              keyword_data: { keyword: "no-rank" },
              first_domain_serp_element: null,
            },
          ],
        },
      ],
      RUN_AT,
    );
    expect(rows.map((r) => r.keyword)).toEqual(["ok"]);
  });
});

describe("providerDate", () => {
  it("reads the provider format and rejects garbage", () => {
    expect(providerDate("2026-10-03 05:42:11 +00:00", RUN_AT)).toBe(
      "2026-10-03T05:42:11.000Z",
    );
    expect(providerDate("soon", RUN_AT)).toBe(RUN_AT);
    expect(providerDate(null, RUN_AT)).toBe(RUN_AT);
  });
});

describe("likelyPageType", () => {
  it("guesses from the path only", () => {
    expect(likelyPageType("https://a.test/")).toBe("homepage");
    expect(likelyPageType("https://a.test/blog/how-to-x")).toBe("article");
    expect(likelyPageType("https://a.test/collections/rope")).toBe(
      "collection",
    );
    expect(likelyPageType("https://a.test/products/rope-swing")).toBe(
      "product",
    );
    expect(likelyPageType("https://a.test/blog/a-vs-b")).toBe("comparison");
    expect(likelyPageType("not a url")).toBeNull();
    expect(likelyPageType(null)).toBeNull();
  });
});

const row = (over: Partial<GapRowForAction> = {}): GapRowForAction => ({
  keyword: "tree swing seat",
  kind: "missing",
  searchVolume: 1200,
  keywordDifficulty: 20,
  bestPosition: 3,
  bestDomain: "a.test",
  bestUrl: "https://a.test/collections/swings",
  competitorCount: 2,
  targetPosition: null,
  targetUrl: null,
  observedAt: RUN_AT,
  ...over,
});
const ctx = {
  locationCode: 2840,
  brandTerms: ["Acme"],
  store: null,
  targetPageUrl: null,
};

describe("candidateFromGapRow", () => {
  it("never recommends an article where the winner is a commercial page", () => {
    const result = candidateFromGapRow(row(), ctx);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.candidate.action).toBe("create_page");
  });

  it("recommends an article for informational intent with an article winner", () => {
    const result = candidateFromGapRow(
      row({
        keyword: "how to hang a tree swing",
        bestUrl: "https://a.test/blog/hang-swing",
      }),
      ctx,
    );
    if (!result.ok) throw new Error("expected a candidate");
    expect(result.candidate.action).toBe("new_article");
  });

  it("refreshes the attached page instead of creating new content", () => {
    const result = candidateFromGapRow(
      row({
        kind: "outranked",
        targetPosition: 9,
        targetUrl: "https://me.test/p",
      }),
      ctx,
    );
    if (!result.ok) throw new Error("expected a candidate");
    expect(result.candidate).toMatchObject({
      action: "refresh_existing_page",
      pageUrl: "https://me.test/p",
      dedupeKey: "explorer_gap::2840::tree swing seat",
    });
  });

  it("refuses a keyword that names the brand", () => {
    const result = candidateFromGapRow(row({ keyword: "acme swings" }), ctx);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("names this brand");
  });

  it("states a missing volume instead of inventing one", () => {
    const result = candidateFromGapRow(row({ searchVolume: null }), ctx);
    if (!result.ok) throw new Error("expected a candidate");
    expect(result.candidate.priority).toBe("low");
    expect(
      result.candidate.evidence.some((e) => e.label.includes("search volume")),
    ).toBe(false);
  });
});
