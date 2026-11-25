import { DomainService } from "@/server/features/domain/services/DomainService";
import type { CustomerContext } from "@/server/lib/customer-context";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";
import { getLanguageCode } from "@/shared/keyword-locations";

export const MAX_MARKETS = 5;

type MarketsInput = {
  projectId: string;
  domain: string;
  locationCodes: number[];
};

function marketOf(locationCode: number) {
  return { locationCode, languageCode: getLanguageCode(locationCode) };
}

/**
 * What reading these markets would cost, before anything is read. A market
 * already read in the last 12 hours is free, because the overview cache is
 * shared with the page's own headline read.
 */
async function planMarkets(
  input: MarketsInput,
  billingCustomer: CustomerContext,
) {
  const domain = parseResearchTargetOrThrow(input.domain).hostname;
  const markets = await Promise.all(
    input.locationCodes.slice(0, MAX_MARKETS).map(async (locationCode) => {
      const market = marketOf(locationCode);
      const stored = await DomainService.getStoredOverview(
        { projectId: input.projectId, domain, ...market },
        billingCustomer,
      );
      return {
        locationCode,
        cached: stored !== null,
        estimateUsd:
          stored !== null
            ? 0
            : dataforseoPricing.domain.rankOverview({
                target: domain,
                ...market,
              }),
      };
    }),
  );
  return {
    domain,
    markets,
    totalUsd: markets.reduce((total, market) => total + market.estimateUsd, 0),
  };
}

/** One overview per market, each settled on its own so one failure keeps the rest. */
async function readMarkets(
  input: MarketsInput,
  billingCustomer: CustomerContext,
) {
  const domain = parseResearchTargetOrThrow(input.domain).hostname;
  const rows = await Promise.all(
    input.locationCodes.slice(0, MAX_MARKETS).map(async (locationCode) => {
      try {
        const overview = await DomainService.getOverview(
          {
            projectId: input.projectId,
            domain,
            ...marketOf(locationCode),
          },
          billingCustomer,
        );
        return {
          locationCode,
          status: "ok" as const,
          hasData: overview.hasData,
          organicKeywords: overview.organicKeywords,
          organicTraffic: overview.organicTraffic,
          fetchedAt: overview.fetchedAt,
        };
      } catch (error) {
        console.error("domain.markets.read failed:", error);
        return { locationCode, status: "error" as const };
      }
    }),
  );
  return { domain, rows };
}

export const DomainMarketsService = { planMarkets, readMarkets };
