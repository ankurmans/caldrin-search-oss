import { describe, expect, it } from "vitest";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import { creditsForProviderUsd } from "@/shared/credits";
import { estimateRankCheckCredits } from "@/shared/rank-tracking";

const location = { locationCode: 2840, languageCode: "en" };

describe("dataforseoPricing", () => {
  it.each([
    {
      name: "Labs research, 500 rows with clickstream (incident shape)",
      estimateUsd: dataforseoPricing.keywords.related({
        keyword: "seo",
        ...location,
        limit: 500,
        includeClickstreamData: true,
      }),
      rawUsd: 0.144,
      credits: 144,
    },
    {
      name: "Labs research, default 150 rows",
      estimateUsd: dataforseoPricing.keywords.suggestions({
        keyword: "seo",
        ...location,
        limit: 150,
      }),
      rawUsd: 0.03,
      credits: 30,
    },
    {
      name: "merged SERP reads at the default depth (page 1)",
      estimateUsd: dataforseoPricing.serp.readsTaskPost({
        keyword: "seo",
        ...location,
      }),
      rawUsd: 0.0036,
      credits: 4,
    },
    {
      name: "merged SERP reads with final URLs (standard queue, half the rate)",
      estimateUsd: dataforseoPricing.serp.readsTaskPost({
        keyword: "seo",
        ...location,
        finalUrls: true,
      }),
      rawUsd: 0.0018,
      credits: 2,
    },
    {
      name: "merged SERP reads at depth 20",
      estimateUsd: dataforseoPricing.serp.readsTaskPost({
        keyword: "seo",
        ...location,
        depth: 20,
      }),
      rawUsd: 0.0063,
      credits: 7,
    },
    {
      name: "merged SERP reads at depth 100",
      estimateUsd: dataforseoPricing.serp.readsTaskPost({
        keyword: "seo",
        ...location,
        depth: 100,
      }),
      rawUsd: 0.0279,
      credits: 28,
    },
    {
      name: "merged SERP reads for a keyword with a search operator (billed 5x)",
      estimateUsd: dataforseoPricing.serp.readsTaskPost({
        keyword: "site:example.com seo",
        ...location,
      }),
      rawUsd: 0.018,
      credits: 18,
    },
    {
      name: "Lighthouse run",
      estimateUsd: dataforseoPricing.lighthouse.live({
        url: "https://example.com",
        strategy: "mobile",
      }),
      rawUsd: 0.005,
      credits: 5,
    },
    {
      name: "backlinks history over one year",
      estimateUsd: dataforseoPricing.backlinks.history({
        target: "example.com",
        dateFrom: "2025-09-09",
        dateTo: "2026-09-08",
      }),
      rawUsd: 0.024 + 365 * 0.000036,
      credits: 38,
    },
  ])("$name", ({ estimateUsd, rawUsd, credits }) => {
    expect(estimateUsd).toBeCloseTo(rawUsd, 10);
    expect(creditsForProviderUsd(estimateUsd)).toBe(credits);
  });

  it.each([
    { includeOtherSources: false, billedUsd: 0.00375 },
    { includeOtherSources: true, billedUsd: 0.01 },
  ])(
    "holds at least the billed cost of a depth-20 reviews post (other sources: $includeOtherSources)",
    ({ includeOtherSources, billedUsd }) => {
      const estimateUsd = dataforseoPricing.business.reviewsTaskPost({
        cid: "123",
        ...location,
        depth: 20,
        sortBy: "newest",
        includeOtherSources,
      });
      expect(creditsForProviderUsd(estimateUsd)).toBeGreaterThanOrEqual(
        creditsForProviderUsd(billedUsd),
      );
    },
  );

  // Real bills read from DataForSEO's id_list, each above the earlier estimate.
  const near = { locationCoordinate: "40.74,-73.98", languageCode: "en" };
  it.each([
    {
      name: "Q&A at depth 10",
      estimateUsd: dataforseoPricing.business.questionsAnswers({
        keyword: "x",
        ...near,
        depth: 10,
      }),
      billedUsd: 0.0054,
    },
    {
      name: "Q&A at depth 30",
      estimateUsd: dataforseoPricing.business.questionsAnswers({
        keyword: "x",
        ...near,
        depth: 30,
      }),
      billedUsd: 0.0108,
    },
    {
      name: "Local Finder at depth 100",
      estimateUsd: dataforseoPricing.serp.local({
        keyword: "x",
        ...near,
        searchType: "local_finder",
        device: "mobile",
        depth: 100,
      }),
      billedUsd: 0.02,
    },
    {
      name: "Maps tasks queued at high priority",
      estimateUsd: dataforseoPricing.serp.localTaskPost({
        keyword: "x",
        locationCoordinates: ["1,1,13z", "2,2,13z"],
        languageCode: "en",
        device: "mobile",
        depth: 20,
      }),
      billedUsd: 0.0024,
    },
  ])(
    "holds at least the measured bill: $name",
    ({ estimateUsd, billedUsd }) => {
      expect(estimateUsd).toBeGreaterThanOrEqual(billedUsd);
    },
  );

  it("prices a queued task_post batch the way the rank check estimate does", () => {
    // Operator keywords bill 5x, so approvals must see the same mix.
    const keywords = Array.from({ length: 100 }, (_, i) =>
      i % 10 === 0 ? `site:example.com kw ${i}` : `kw ${i}`,
    );
    const estimateUsd = dataforseoPricing.serp.rankCheckTaskPost({
      tasks: keywords.map((keyword, i) => ({
        keyword,
        keywordId: `id-${i}`,
        device: "desktop" as const,
      })),
      ...location,
      depth: 20,
    });
    // The estimate is the worst case: six reads.
    expect(6 * creditsForProviderUsd(estimateUsd)).toBe(
      estimateRankCheckCredits(keywords, "desktop", 20).costCredits,
    );
  });
});
