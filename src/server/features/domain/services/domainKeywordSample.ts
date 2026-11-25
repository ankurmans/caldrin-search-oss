import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import type { CustomerContext } from "@/server/lib/customer-context";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { joinClauses } from "@/server/lib/dataforseo/filters";
import { buildRankedKeywordsScopeFilter } from "@/server/lib/dataforseo/researchScopeFilters";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";
import type { ResearchScope } from "@/shared/researchScope";
import { domainKeywordSchema } from "@/server/features/domain/services/domainKeywordsPage";
import { mapKeywordItem } from "@/server/features/domain/services/domainKeywordMapper";

/** How many of the highest-traffic keywords every top-N figure rests on. */
const KEYWORD_SAMPLE_SIZE = 100;
const KEYWORD_SAMPLE_TTL_SECONDS = 12 * 60 * 60;

const keywordSampleSchema = z.object({
  domain: z.string(),
  keywords: z.array(domainKeywordSchema),
  // How many keywords the provider lists for the whole target.
  totalCount: z.number().nullable(),
  fetchedAt: z.string(),
});

type KeywordSample = z.infer<typeof keywordSampleSchema>;

type KeywordSampleInput = {
  projectId: string;
  domain: string;
  scope?: ResearchScope;
  locationCode: number;
  languageCode: string;
};

async function keywordSampleCacheKey(
  input: KeywordSampleInput,
  billingCustomer: CustomerContext,
) {
  const target = parseResearchTargetOrThrow(input.domain, input.scope);
  return {
    target,
    cacheKey: await buildCacheKey("domain:keyword-sample", {
      organizationId: billingCustomer.organizationId,
      projectId: input.projectId,
      domain: target.hostname,
      scope: target.scope,
      path: target.path,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      size: KEYWORD_SAMPLE_SIZE,
    }),
  };
}

/** The sample already read for this market, or null. Never calls the provider. */
export async function getStoredKeywordSample(
  input: KeywordSampleInput,
  billingCustomer: CustomerContext,
): Promise<KeywordSample | null> {
  const { cacheKey } = await keywordSampleCacheKey(input, billingCustomer);
  const cached = keywordSampleSchema.safeParse(await getCached(cacheKey));
  return cached.success ? cached.data : null;
}

/**
 * The domain's highest-traffic keywords with everything the mapper keeps. One
 * provider read, cached per target and market, shared by the keyword
 * suggestions and the intent and name-match summary.
 */
export async function getKeywordSample(
  input: KeywordSampleInput,
  billingCustomer: CustomerContext,
): Promise<KeywordSample> {
  const { target, cacheKey } = await keywordSampleCacheKey(
    input,
    billingCustomer,
  );
  const scopeFilter = buildRankedKeywordsScopeFilter(target);

  const cached = keywordSampleSchema.safeParse(await getCached(cacheKey));
  if (cached.success) return cached.data;

  const response = await createDataforseoClient(
    billingCustomer,
  ).domain.rankedKeywords({
    target: target.hostname,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: KEYWORD_SAMPLE_SIZE,
    orderBy: ["ranked_serp_element.serp_item.etv,desc"],
    filters:
      scopeFilter.clauses.length > 0
        ? joinClauses(scopeFilter.clauses, "and")
        : undefined,
  });

  const sample: KeywordSample = {
    domain: target.hostname,
    keywords: response.items.flatMap((item) => mapKeywordItem(item) ?? []),
    totalCount: response.totalCount,
    fetchedAt: new Date().toISOString(),
  };

  if (sample.keywords.length > 0) {
    waitUntil(
      setCached(cacheKey, sample, KEYWORD_SAMPLE_TTL_SECONDS).catch((error) => {
        console.error("domain.keyword-sample.cache-write failed:", error);
      }),
    );
  }
  return sample;
}
