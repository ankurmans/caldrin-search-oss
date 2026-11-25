import type { CustomerContext } from "@/server/lib/customer-context";
import { mapKeywordItem } from "@/server/features/domain/services/domainKeywordMapper";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import {
  MAX_COMPETITOR_POSITION,
  MIN_GAP_SEARCH_VOLUME,
} from "../rules/keywordGapPlan";
import type { CompetitorKeyword, PaidKeywordSource } from "../types";

// Reads each saved competitor's ranked keywords through the billing-aware
// DataForSEO client (the same seam every other paid read uses), narrowed to
// the positions and volumes the rule keeps and sorted by volume so the row
// limit keeps the biggest ones. Comparing against the site's own queries is
// the rule's job, using Search Console rows the project already has.
export function createDataForSeoKeywordSource(
  billing: CustomerContext,
  location: { locationCode: number; languageCode: string },
): PaidKeywordSource {
  return {
    async fetchCompetitorKeywords({ competitorDomains, limit }) {
      const client = createDataforseoClient(billing);
      const observedAt = new Date().toISOString();
      const keywords: CompetitorKeyword[] = [];
      for (const domain of competitorDomains) {
        const page = await client.domain.rankedKeywords({
          target: domain,
          ...location,
          limit,
          orderBy: ["keyword_data.keyword_info.search_volume,desc"],
          filters: [
            [
              "ranked_serp_element.serp_item.rank_absolute",
              "<=",
              MAX_COMPETITOR_POSITION,
            ],
            "and",
            [
              "keyword_data.keyword_info.search_volume",
              ">=",
              MIN_GAP_SEARCH_VOLUME,
            ],
          ],
        });
        for (const item of page.items) {
          const mapped = mapKeywordItem(item);
          if (!mapped || mapped.position === null) continue;
          keywords.push({
            keyword: mapped.keyword,
            competitorDomain: domain,
            competitorPosition: mapped.position,
            competitorUrl: mapped.url,
            searchVolume: mapped.searchVolume,
            keywordDifficulty: mapped.keywordDifficulty,
          });
        }
      }
      // The metered client returns data without the provider's billed amount,
      // so the engine records the estimate that was checked against the limits.
      return { keywords, observedAt, costUsd: null };
    },
  };
}
