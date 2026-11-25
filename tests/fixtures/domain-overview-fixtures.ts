import { parseResearchTarget } from "@/shared/researchScope";

export function getFixtureOverview(domain: string) {
  const parsed = parseResearchTarget(domain);
  const target = parsed.ok ? parsed.target : null;
  return {
    domain: target?.hostname ?? domain,
    scope: target?.scope ?? "domain",
    displayTarget: target?.display ?? domain,
    organicTraffic: 373,
    organicKeywords: 307,
    keywords: 307,
    traffic: 373,
    trafficValueUsd: 1200,
    positions: {
      top1: 10,
      top2to3: 20,
      top4to10: 60,
      top11to20: 90,
      top21to50: 90,
      top51to100: 37,
    },
    movement: {
      newKeywords: 12,
      risingKeywords: 40,
      decliningKeywords: 30,
      lostKeywords: null,
    },
    hasData: true,
    fetchedAt: "2026-05-19T00:00:00.000Z",
  };
}

export function getFixtureHistory(domain: string) {
  const months = ["2026-03", "2026-04", "2026-05"].map((month, index) => ({
    month,
    keywords: 280 + index * 13,
    traffic: 340 + index * 16,
    trafficValueUsd: 1100 + index * 50,
    positions: getFixtureOverview(domain).positions,
    movement: {
      newKeywords: 12,
      risingKeywords: 40,
      decliningKeywords: 30,
      lostKeywords: 8,
    },
  }));
  return { domain, months, fetchedAt: "2026-05-19T00:00:00.000Z" };
}

export function getFixturePagesPage(data: {
  domain: string;
  page: number;
  pageSize: number;
}) {
  const rows = [
    ["/section-a/page-001", 179, 34],
    ["/section-a/page-002", 63, 9],
    ["/section-b/page-003", 23, 25],
    ["/section-b/page-004", 19, 16],
    ["/section-b/page-005", 17, 12],
    ["/section-c/page-006", 8, 7],
    ["/section-c/page-007", 8, 11],
    ["/guides/topic-008", 3, 10],
    ["/guides/topic-009", 3, 11],
    ["/guides/topic-010", 3, 7],
    ["/guides/topic-011", 3, 6],
    ["/guides/topic-012", 2, 5],
  ];
  const pages = rows.map(([path, traffic, keywords]) => ({
    page: `https://${data.domain}${path}`,
    relativePath: String(path),
    organicTraffic: Number(traffic),
    keywords: Number(keywords),
  }));

  return {
    domain: data.domain,
    page: data.page,
    pageSize: data.pageSize,
    totalCount: 66,
    hasMore: data.page * data.pageSize < 66,
    pages,
    fetchedAt: "2026-05-19T00:00:00.000Z",
  };
}

export function getFixtureKeywordSummary(domain: string) {
  return {
    domain,
    totalListed: 307,
    fetchedAt: "2026-05-19T00:00:00.000Z",
    sampleSize: 100,
    intents: {
      informational: { keywords: 60, traffic: 400 },
      commercial: { keywords: 30, traffic: 250 },
      unclassified: { keywords: 10, traffic: 20 },
    },
    nameMatch: null,
    serpFeatures: [
      { feature: "people_also_ask", keywords: 52 },
      { feature: "images", keywords: 31 },
    ],
  };
}

export function getFixturePagesSummary(domain: string) {
  return {
    domain,
    totalListed: 120,
    sampleSize: 100,
    fetchedAt: "2026-05-19T00:00:00.000Z",
    folders: [
      { folder: "/section-a/", pages: 70, traffic: 500 },
      { folder: "(home page)", pages: 1, traffic: 80 },
    ],
  };
}

export function getFixtureCompetitors(domain: string) {
  return {
    domain,
    isProjectDomain: false,
    source: "live" as const,
    totalCount: 250,
    fetchedAt: "2026-05-19T00:00:00.000Z",
    headToHeadUsd: 0.0132,
    items: [
      {
        domain: "rival-one.example.com",
        sharedKeywords: 120,
        avgPosition: 14.2,
        organicKeywords: 900,
        organicTraffic: 4_200,
      },
      {
        domain: "rival-two.example.com",
        sharedKeywords: 80,
        avgPosition: 22.5,
        organicKeywords: 400,
        organicTraffic: 1_100,
      },
    ],
  };
}

export function getFixtureAiMentions(domain: string) {
  const mention = (
    question: string,
    platform: "chat_gpt" | "google",
    cited: boolean,
  ) => ({
    question,
    platform,
    aiSearchVolume: 120,
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    lastSeenAt: "2026-05-10T00:00:00.000Z",
    citedSources: cited
      ? [{ url: `https://${domain}/guide`, domain, title: "Guide" }]
      : [
          {
            url: "https://other.example.net/best",
            domain: "other.example.net",
            title: "Best",
          },
        ],
    brandsMentioned: ["Sample Brand", "Other Brand"],
  });
  return {
    status: "stored" as const,
    domain,
    fetchedAt: "2026-05-19T00:00:00.000Z",
    hasData: true,
    totalMentions: 84,
    perPlatform: [
      {
        platform: "chat_gpt" as const,
        status: "success" as const,
        mentions: 30,
        aiSearchVolume: 900,
      },
      {
        platform: "google" as const,
        status: "success" as const,
        mentions: 54,
        aiSearchVolume: 1_400,
      },
    ],
    topQueries: [
      mention("primary sample query", "google", true),
      mention("secondary sample query", "google", false),
      mention("what is the best sample tool", "chat_gpt", true),
      mention("how do I compare sample tools", "chat_gpt", false),
    ],
    topPages: [
      {
        url: `https://${domain}/guide`,
        domain,
        platform: "google" as const,
        mentions: 12,
        capturedVolume: 300,
        keywords: [{ question: "primary sample query", aiSearchVolume: 120 }],
      },
    ],
  };
}

const organic = (position: number | null, url: string | null) => ({
  source: "provider_keywords" as const,
  position,
  depth: null,
  url,
  checkedAt: "2026-05-08T00:00:00.000Z",
  locationCode: 2840,
});

export function getFixtureIntersection(domain: string) {
  const answer = (cited: boolean, named = true) => ({
    engine: "google_ai_overview" as const,
    source: "provider_mentions" as const,
    named,
    cited,
    recommended: null,
    citedUrls: cited ? [`https://${domain}/guide`] : [],
    competingUrls: cited ? [] : ["https://other.example.net/best"],
    observedAt: "2026-05-10T00:00:00.000Z",
    locationCode: 2840,
    comparison: { comparable: true as const, daysApart: 2 },
  });
  return {
    domain,
    isOwn: false,
    locationCode: 2840,
    languageCode: "en",
    sources: {
      providerMentions: {
        status: "stored" as const,
        fetchedAt: "2026-05-19T00:00:00.000Z",
      },
      keywordSample: {
        status: "stored" as const,
        fetchedAt: "2026-05-19T00:00:00.000Z",
        keywords: 100,
      },
      trackedAnswers: 0,
      trackedRanks: 0,
    },
    counts: {
      aiQueries: 3,
      withOrganic: 2,
      comparable: 2,
      withoutOrganic: 1,
      organicWithoutAi: 60,
    },
    rows: [
      {
        key: "secondary sample query",
        query: "secondary sample query",
        prompt: null,
        organic: organic(4, `https://${domain}/page`),
        organicState: "ranked" as const,
        answers: [answer(false)],
        aiState: "named_only" as const,
        comparable: true,
        gap: "ranks_not_cited" as const,
        opportunity: {
          ok: true as const,
          action: "refresh_existing_page" as const,
          pageUrl: `https://${domain}/page`,
          reason: "The page ranks at 4 but the AI answers do not cite it.",
          priority: "high" as const,
        },
      },
      {
        key: "primary sample query",
        query: "primary sample query",
        prompt: null,
        organic: organic(1, `https://${domain}/guide`),
        organicState: "ranked" as const,
        answers: [answer(true)],
        aiState: "cited" as const,
        comparable: true,
        gap: null,
        opportunity: null,
      },
      {
        key: "what is the best sample tool",
        query: "what is the best sample tool",
        prompt: null,
        organic: null,
        organicState: "no_capture" as const,
        answers: [{ ...answer(true), comparison: null }],
        aiState: "no_answers" as const,
        comparable: false,
        gap: null,
        opportunity: null,
      },
    ],
  };
}

export function getFixtureHeadToHead(
  domain: string,
  competitor: string,
  kind: "gap" | "shared",
) {
  return {
    domain,
    competitor,
    kind,
    totalCount: 40,
    fetchedAt: "2026-05-19T00:00:00.000Z",
    keywords: [
      {
        keyword: "sample gap keyword",
        searchVolume: 1_900,
        keywordDifficulty: 31,
        intent: "informational",
        competitorPosition: 3,
        competitorUrl: `https://${competitor}/guide`,
        domainPosition: kind === "shared" ? 12 : null,
        domainUrl: kind === "shared" ? `https://${domain}/page` : null,
      },
    ],
  };
}

export function getFixtureKeywordsPage(data: {
  domain: string;
  page: number;
  pageSize: number;
}) {
  const rows = [
    ["primary sample query", 1, 4_400, 86, 0.61, 18],
    ["secondary sample query", 2, 3_600, 74, 0.82, 24],
    ["tertiary sample query", 1, 1_900, 51, 0.44, 21],
    ["sample comparison term", 3, 1_600, 39, 0.52, 28],
    ["sample evaluation term", 4, 1_300, 31, 0.49, 25],
    ["sample reference term", 5, 1_100, 24, 0.37, 19],
  ];
  const keywords = rows.map(
    (
      [keyword, position, searchVolume, traffic, cpc, keywordDifficulty],
      index,
    ) => ({
      keyword: String(keyword),
      position: Number(position),
      previousPosition: index === 0 ? null : Number(position) + (index % 2),
      change: index === 0 ? ("new" as const) : ("down" as const),
      intent: index % 2 === 0 ? "informational" : "commercial",
      serpFeatures: index % 2 === 0 ? ["people_also_ask", "images"] : [],
      monthlySearches: [
        { month: "2026-03", volume: Number(searchVolume) - 100 },
        { month: "2026-04", volume: Number(searchVolume) },
      ],
      serpCheckedAt: "2026-05-10",
      previousSerpCheckedAt: "2026-04-10",
      searchVolume: Number(searchVolume),
      traffic: Number(traffic),
      cpc: Number(cpc),
      url: `https://${data.domain}/section-a/page-001`,
      relativeUrl: "/section-a/page-001",
      keywordDifficulty: Number(keywordDifficulty),
    }),
  );

  return {
    domain: data.domain,
    page: data.page,
    pageSize: data.pageSize,
    totalCount: 307,
    hasMore: data.page * data.pageSize < 307,
    keywords,
    fetchedAt: "2026-05-19T00:00:00.000Z",
  };
}
