import { waitUntil } from "cloudflare:workers";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { z } from "zod";
import type { CustomerContext } from "@/server/lib/customer-context";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";
import type { ResearchScope } from "@/shared/researchScope";
import { getKeywordsPage } from "@/server/features/domain/services/domainKeywordsPage";
import { getPagesPage } from "@/server/features/domain/services/domainPagesPage";
import {
  getCompetitors,
  getHeadToHead,
} from "@/server/features/domain/services/domainCompetitors";
import { summarizePageFolders } from "@/server/features/domain/services/domainPagesSummary";
import { getKeywordSample } from "@/server/features/domain/services/domainKeywordSample";
import { summarizeKeywordSample } from "@/server/features/domain/services/domainKeywordSummary";
import {
  getDomainHistory,
  getStoredDomainHistory,
} from "@/server/features/domain/services/domainHistory";
import {
  mapOrganicMetrics,
  organicMetricsSchema,
} from "@/server/features/domain/services/domainMetrics";

// Lets a caller attribute spend to its own feature (e.g. the SAM agent). Applied
// to the DataForSEO call, not the cache key, so cached results are shared
// across callers.
type MeteringOverrides = {};

/** Pages the folder summary rests on: the highest-traffic ones. */
const PAGES_SAMPLE_SIZE = 100;

/** Domain overview data is refreshed every 12 hours. */
const DOMAIN_OVERVIEW_TTL_SECONDS = 12 * 60 * 60;

// `organicKeywords` is the canonical organic keyword count everywhere in the
// app: the provider's monthly organic aggregate, the same figure the monthly
// history reports for the current month. The ranked-keywords list total is a
// different, larger count (each keyword's latest stored SERP check) and is
// never shown as this number.
const domainOverviewResultSchema = organicMetricsSchema.extend({
  domain: z.string(),
  organicTraffic: z.number().nullable(),
  organicKeywords: z.number().nullable(),
  hasData: z.boolean(),
  fetchedAt: z.string(),
});

type DomainOverviewResult = z.infer<typeof domainOverviewResultSchema> & {
  /** Requested research scope, echoed for display. */
  scope: ResearchScope;
  displayTarget: string;
};

// domain_rank_overview has no filters and always covers the hostname plus
// all of its subdomains, so every scope shares one cache entry per hostname.
// Callers label the metrics as domain-wide for narrower scopes.
function overviewCacheKey(
  input: { projectId: string; locationCode: number; languageCode: string },
  billingCustomer: CustomerContext,
  domain: string,
) {
  return buildCacheKey("domain:overview", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
}

/**
 * The last overview read for this market, even past its refresh window, or
 * null. Never calls the provider.
 */
async function getStoredOverview(
  input: {
    projectId: string;
    domain: string;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: CustomerContext,
) {
  const domain = parseResearchTargetOrThrow(input.domain).hostname;
  const cached = domainOverviewResultSchema.safeParse(
    await getCached(await overviewCacheKey(input, billingCustomer, domain), {
      allowExpired: true,
    }),
  );
  return cached.success && cached.data.hasData ? cached.data : null;
}

async function getOverview(
  input: {
    projectId: string;
    domain: string;
    scope?: ResearchScope;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: CustomerContext,
  metering: MeteringOverrides = {},
): Promise<DomainOverviewResult> {
  const target = parseResearchTargetOrThrow(input.domain, input.scope);
  const domain = target.hostname;

  const cacheKey = await overviewCacheKey(input, billingCustomer, domain);

  const cachedRaw = await getCached(cacheKey);
  const cached = domainOverviewResultSchema.safeParse(cachedRaw);
  if (cached.success && cached.data.hasData) {
    return {
      ...cached.data,
      scope: target.scope,
      displayTarget: target.display,
    };
  }

  const nowIso = new Date().toISOString();
  const dataforseo = createDataforseoClient(billingCustomer);

  const metricsResponse = await dataforseo.domain.rankOverview({
    target: domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    ...metering,
  });

  const metrics = metricsResponse[0];

  const organic = mapOrganicMetrics(metrics?.metrics?.organic);
  const organicTraffic = organic.traffic;
  const organicKeywords = organic.keywords;

  const stored: z.infer<typeof domainOverviewResultSchema> = {
    ...organic,
    domain,
    organicTraffic,
    organicKeywords,
    hasData: organicKeywords != null && organicKeywords > 0,
    fetchedAt: nowIso,
  };

  if (stored.hasData) {
    // waitUntil, not void: workerd cancels unregistered pending I/O once the
    // response is sent, so a fire-and-forget put never persists the cache.
    waitUntil(
      setCached(cacheKey, stored, DOMAIN_OVERVIEW_TTL_SECONDS).catch(
        (error) => {
          console.error("domain.overview.cache-write failed:", error);
        },
      ),
    );
  }

  return { ...stored, scope: target.scope, displayTarget: target.display };
}

async function getSuggestedKeywords(
  input: {
    domain: string;
    scope?: ResearchScope;
    locationCode: number;
    languageCode: string;
    organizationId: string;
    projectId: string;
  },
  billingCustomer: CustomerContext,
): Promise<
  Array<{
    keyword: string;
    position: number | null;
    searchVolume: number | null;
    traffic: number | null;
    cpc: number | null;
    keywordDifficulty: number | null;
  }>
> {
  const sample = await getKeywordSample(input, billingCustomer);
  return sample.keywords.map((item) => ({
    keyword: item.keyword,
    position: item.position,
    searchVolume: item.searchVolume,
    traffic: item.traffic,
    cpc: item.cpc,
    keywordDifficulty: item.keywordDifficulty,
  }));
}

async function getKeywordSummary(
  input: {
    projectId: string;
    domain: string;
    scope?: ResearchScope;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: CustomerContext,
) {
  const sample = await getKeywordSample(input, billingCustomer);
  return {
    domain: sample.domain,
    totalListed: sample.totalCount,
    fetchedAt: sample.fetchedAt,
    ...summarizeKeywordSample(sample.keywords, sample.domain),
  };
}

async function getPagesSummary(
  input: {
    projectId: string;
    domain: string;
    scope?: ResearchScope;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: CustomerContext,
) {
  const result = await getPagesPage(
    {
      ...input,
      page: 1,
      pageSize: PAGES_SAMPLE_SIZE,
      sortMode: "traffic",
      sortOrder: "desc",
      filters: {},
    },
    billingCustomer,
  );
  return {
    domain: result.domain,
    totalListed: result.totalCount,
    sampleSize: result.pages.length,
    folders: summarizePageFolders(result.pages),
    fetchedAt: result.fetchedAt,
  };
}

export const DomainService = {
  getOverview,
  getStoredOverview,
  getHistory: getDomainHistory,
  getStoredHistory: getStoredDomainHistory,
  getSuggestedKeywords,
  getKeywordSummary,
  getPagesSummary,
  getCompetitors,
  getHeadToHead,
  getKeywordsPage,
  getPagesPage,
} as const;
