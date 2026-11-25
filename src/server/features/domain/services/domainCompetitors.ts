import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { CompetitorExplorerService } from "@/server/features/site-explorer/services/CompetitorExplorerService";
import { normaliseDomain } from "@/server/features/site-explorer/rules/gapMerge";
import type { CustomerContext } from "@/server/lib/customer-context";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";

const COMPETITORS_TTL_SECONDS = 12 * 60 * 60;
const COMPETITOR_LIMIT = 20;
const HEAD_TO_HEAD_LIMIT = 25;
const VOLUME_ORDER = ["keyword_data.keyword_info.search_volume,desc"];

const competitorsResultSchema = z.object({
  domain: z.string(),
  // True when the domain is the project's own, so the page can offer the
  // stored keyword gap beside it.
  isProjectDomain: z.boolean(),
  // "stored" is the project's own competitor discovery, reused without a read.
  source: z.enum(["live", "stored"]),
  totalCount: z.number().nullable(),
  fetchedAt: z.string(),
  // Upper bound for one head-to-head read, shown on its button.
  headToHeadUsd: z.number(),
  items: z.array(
    z.object({
      domain: z.string(),
      sharedKeywords: z.number().nullable(),
      avgPosition: z.number().nullable(),
      organicKeywords: z.number().nullable(),
      organicTraffic: z.number().nullable(),
    }),
  ),
});
type CompetitorsResult = z.infer<typeof competitorsResultSchema>;

const headToHeadSchema = z.object({
  domain: z.string(),
  competitor: z.string(),
  kind: z.enum(["gap", "shared"]),
  totalCount: z.number().nullable(),
  fetchedAt: z.string(),
  keywords: z.array(
    z.object({
      keyword: z.string(),
      searchVolume: z.number().nullable(),
      keywordDifficulty: z.number().nullable(),
      intent: z.string().nullable(),
      competitorPosition: z.number().nullable(),
      competitorUrl: z.string().nullable(),
      domainPosition: z.number().nullable(),
      domainUrl: z.string().nullable(),
    }),
  ),
});
type HeadToHeadResult = z.infer<typeof headToHeadSchema>;

type Market = { projectId: string; locationCode: number; languageCode: string };

export async function getCompetitors(
  input: Market & { domain: string },
  billingCustomer: CustomerContext,
): Promise<CompetitorsResult> {
  // The provider compares whole domains, so a subfolder scope reads the host.
  const domain = parseResearchTargetOrThrow(input.domain).hostname;
  const project = await OpportunityRepository.getProjectBrand(input.projectId);
  const isProjectDomain =
    project?.domain != null && normaliseDomain(project.domain) === domain;

  const cacheKey = await buildCacheKey("domain:competitors:no-global", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
  const cached = competitorsResultSchema.safeParse(await getCached(cacheKey));
  if (cached.success) return cached.data;

  const headToHeadUsd = dataforseoPricing.domain.intersection({
    target1: "competitor.example",
    target2: domain,
    intersections: false,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: HEAD_TO_HEAD_LIMIT,
  });

  // The Competitors tab already paid for this domain's list; show it instead
  // of reading the same endpoint again.
  if (isProjectDomain) {
    const stored = await CompetitorExplorerService.cachedDiscovery(
      { ...billingCustomer, projectId: input.projectId },
      { locationCode: input.locationCode, languageCode: input.languageCode },
    );
    if (stored) {
      return {
        domain,
        isProjectDomain,
        source: "stored",
        totalCount: null,
        fetchedAt: stored.observedAt,
        headToHeadUsd,
        items: stored.items,
      };
    }
  }

  const page = await createDataforseoClient(billingCustomer).domain.competitors(
    {
      target: domain,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      limit: COMPETITOR_LIMIT,
    },
  );
  const result: CompetitorsResult = {
    domain,
    isProjectDomain,
    source: "live",
    totalCount: page.totalCount,
    fetchedAt: new Date().toISOString(),
    headToHeadUsd,
    items: page.items.flatMap((item) => {
      const competitor = item.domain ? normaliseDomain(item.domain) : null;
      if (!competitor || competitor === domain) return [];
      const organic = item.full_domain_metrics?.organic;
      return [
        {
          domain: competitor,
          sharedKeywords: item.intersections ?? null,
          avgPosition: item.avg_position ?? null,
          organicKeywords: organic?.count ?? null,
          organicTraffic: organic?.etv ?? null,
        },
      ];
    }),
  };
  waitUntil(
    setCached(cacheKey, result, COMPETITORS_TTL_SECONDS).catch((error) => {
      console.error("domain.competitors.cache-write failed:", error);
    }),
  );
  return result;
}

/**
 * The most-searched keywords the competitor ranks for that the domain does
 * not (`gap`), or that both rank for (`shared`). One provider read, started
 * only by an explicit click.
 */
export async function getHeadToHead(
  input: Market & {
    domain: string;
    competitor: string;
    kind: "gap" | "shared";
  },
  billingCustomer: CustomerContext,
): Promise<HeadToHeadResult> {
  const domain = parseResearchTargetOrThrow(input.domain).hostname;
  const competitor = normaliseDomain(input.competitor);
  if (!competitor) throw new Error("Not a valid competitor domain.");

  const cacheKey = await buildCacheKey("domain:head-to-head", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    competitor,
    kind: input.kind,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
  const cached = headToHeadSchema.safeParse(await getCached(cacheKey));
  if (cached.success) return cached.data;

  const page = await createDataforseoClient(
    billingCustomer,
  ).domain.intersection({
    target1: competitor,
    target2: domain,
    intersections: input.kind === "shared",
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: HEAD_TO_HEAD_LIMIT,
    orderBy: VOLUME_ORDER,
  });

  const result: HeadToHeadResult = {
    domain,
    competitor,
    kind: input.kind,
    totalCount: page.totalCount,
    fetchedAt: new Date().toISOString(),
    keywords: page.items.flatMap((item) => {
      const keyword = item.keyword_data?.keyword;
      if (!keyword) return [];
      const info = item.keyword_data?.keyword_info;
      const theirs = item.first_domain_serp_element;
      const ours = item.second_domain_serp_element;
      return [
        {
          keyword,
          searchVolume: info?.search_volume ?? null,
          keywordDifficulty:
            item.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
          intent: item.keyword_data?.search_intent_info?.main_intent ?? null,
          competitorPosition: theirs?.rank_absolute ?? null,
          competitorUrl: theirs?.url ?? null,
          domainPosition: ours?.rank_absolute ?? null,
          domainUrl: ours?.url ?? null,
        },
      ];
    }),
  };
  waitUntil(
    setCached(cacheKey, result, COMPETITORS_TTL_SECONDS).catch((error) => {
      console.error("domain.head-to-head.cache-write failed:", error);
    }),
  );
  return result;
}
