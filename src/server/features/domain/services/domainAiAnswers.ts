import {
  estimateBrandLookupUsd,
  getStoredBrandLookup,
} from "@/server/features/ai-search/services/brandLookup";
import type { CustomerContext } from "@/server/lib/customer-context";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";

/**
 * The stored lookup in full, for the AI Mentions tab: per-engine counts, the
 * questions the provider saw with their cited pages, and the pages cited most.
 * Like the overview card it never starts a lookup.
 */
async function getMentions(
  input: {
    projectId: string;
    domain: string;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: CustomerContext,
) {
  const domain = parseResearchTargetOrThrow(input.domain).hostname;
  const stored = await getStoredBrandLookup(
    {
      projectId: input.projectId,
      query: domain,
      competitors: [],
      locationCode: input.locationCode,
      languageCode: input.languageCode,
    },
    billingCustomer,
  );
  if (!stored) {
    return {
      status: "not_run" as const,
      domain,
      estimateUsd: estimateBrandLookupUsd(),
    };
  }
  return {
    status: "stored" as const,
    domain,
    fetchedAt: stored.fetchedAt,
    hasData: stored.hasData,
    totalMentions: stored.totalMentions,
    perPlatform: stored.perPlatform,
    topQueries: stored.topQueries,
    topPages: stored.topPages,
  };
}

export const DomainAiAnswersService = { getMentions };
