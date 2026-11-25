import { KeywordResearchRepository } from "@/server/features/keywords/repositories/KeywordResearchRepository";
import {
  normalizeIntent,
  normalizeKeyword,
} from "@/server/features/keywords/services/research/helpers";
import { DataRefreshClaimRepository } from "@/server/features/dashboard/repositories/DataRefreshClaimRepository";
import { SpendService } from "@/server/features/spend/services/SpendService";
import type { CustomerContext } from "@/server/lib/customer-context";
import { meterDataforseoCall } from "@/server/lib/dataforseo/client";
import {
  fetchAdsSearchVolume,
  adsLanguageCode,
  isAdsKeyword,
} from "@/server/lib/dataforseo/google-ads";
import { fetchKeywordOverview } from "@/server/lib/dataforseo/labs";
import { fetchKeywordMetricsForList } from "@/server/lib/dataforseo/keyword-metrics";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import {
  getKeywordDataProvider,
  isLanguageServedForLocation,
} from "@/shared/keyword-locations";
import { canLookUpFanOutTerm } from "@/shared/fanOutKeyword";
import type { SourceFilters } from "@/types/schemas/source-intelligence";
import { SourceActionRefusal } from "../rules/sourceOpportunity";
import { SourceIntelligenceRepository as repo } from "../repositories/SourceIntelligenceRepository";

type Scope = CustomerContext & { projectId: string };
type Input = { filters: SourceFilters; terms: string[] };
const provider = "dataforseo";
const operation = "fan_out_keyword_metrics";

export async function quoteFanOutMetrics(projectId: string, input: Input) {
  const { locationCode, languageCode } = input.filters;
  if (!locationCode || !languageCode)
    throw new SourceActionRefusal(
      "Select one market to look up keyword metrics.",
    );

  const usingAds = getKeywordDataProvider(locationCode) === "google_ads";
  const languageSupported = usingAds
    ? Boolean(adsLanguageCode(languageCode))
    : isLanguageServedForLocation(locationCode, languageCode);
  if (!languageSupported)
    throw new SourceActionRefusal(
      "Keyword metrics are unavailable for this market and language.",
    );

  const requested = [...new Set(input.terms.map(normalizeKeyword))];
  const rows = await repo.queryRows(projectId, input.filters, requested);
  if (rows.length !== requested.length)
    throw new SourceActionRefusal(
      "The selected searches have changed. Reload the table and try again.",
    );

  const keywords = rows
    .filter(
      (row) =>
        row.metricsFetchedAt === null &&
        canLookUpFanOutTerm(row.query) &&
        (!usingAds || isAdsKeyword(row.query)),
    )
    .map((row) => row.query);
  const params = { keywords, locationCode, languageCode };
  const estimate = usingAds
    ? dataforseoPricing.keywords.adsSearchVolume
    : dataforseoPricing.labs.keywordOverview;
  return {
    ...params,
    estimatedUsd: keywords.length ? estimate(params) : 0,
    usingAds,
  };
}

export async function lookUpFanOutMetrics(
  scope: Scope,
  input: Input,
  maxEstimatedUsd: number,
) {
  const key = `fan-out-keywords:${scope.projectId}:${input.filters.locationCode}:${input.filters.languageCode}`;
  const token = await DataRefreshClaimRepository.claim(
    key,
    scope.organizationId,
  );
  if (!token)
    throw new SourceActionRefusal(
      "Another keyword lookup is running for this market. Try again shortly.",
    );

  try {
    const quote = await quoteFanOutMetrics(scope.projectId, input);
    const { estimatedUsd, keywords, locationCode, languageCode } = quote;
    if (estimatedUsd > maxEstimatedUsd)
      throw new SourceActionRefusal(
        "The estimate changed. Review the cost again.",
      );
    if (!keywords.length) return { checked: 0, reported: 0 };
    await SpendService.assertWithinLimits(scope, {
      provider,
      operation,
      estimatedUsd,
    });
    const record = (costUsd: number) =>
      SpendService.recordCost(scope, {
        provider,
        operation,
        costUsd,
        estimatedUsd,
      });
    const rows = await fetchKeywordMetricsForList(
      {
        labs: {
          keywordOverview: (params) =>
            meterDataforseoCall(
              scope,
              () => fetchKeywordOverview(params),
              estimatedUsd,
              record,
            ),
        },
        keywords: {
          adsSearchVolume: (params) =>
            meterDataforseoCall(
              scope,
              () => fetchAdsSearchVolume(params),
              estimatedUsd,
              record,
            ),
        },
      },
      { keywords, locationCode, languageCode },
    );
    const byTerm = new Map(
      rows.map((row) => [normalizeKeyword(row.keyword), row]),
    );
    let reported = 0;
    for (const keyword of keywords) {
      const metrics = byTerm.get(keyword);
      if (metrics?.searchVolume != null || metrics?.keywordDifficulty != null)
        reported++;
      await KeywordResearchRepository.upsertKeywordMetric({
        projectId: scope.projectId,
        keepExisting: true,
        keyword,
        locationCode,
        languageCode,
        searchVolume: metrics?.searchVolume ?? null,
        keywordDifficulty: metrics?.keywordDifficulty ?? null,
        cpc: metrics?.cpc ?? null,
        competition: metrics?.competition ?? null,
        intent: metrics?.intent ? normalizeIntent(metrics.intent) : null,
        monthlySearchesJson: JSON.stringify(metrics?.monthlySearches ?? []),
      });
    }
    return { checked: keywords.length, reported };
  } finally {
    await DataRefreshClaimRepository.finish(key, token, 5000);
  }
}
