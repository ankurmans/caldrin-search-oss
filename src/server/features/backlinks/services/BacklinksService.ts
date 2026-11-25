import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseo";
import type {
  BacklinksLookupInput,
  BacklinksSpamFilterOptions,
} from "@/types/schemas/backlinks";
import {
  profileAnchorsPage,
  profileBacklinksOverview,
  profileBacklinksRowsPage,
  profileReferringDomainsPage,
  profileTopPagesPage,
  storedBacklinksOverview,
  type AnchorsPageServiceInput,
  type BacklinksCache,
  type BacklinksRowsPageServiceInput,
  type ReferringDomainsPageServiceInput,
  type TopPagesPageServiceInput,
} from "@/server/features/backlinks/services/backlinksServiceData";
import type { CustomerContext } from "@/server/lib/customer-context";

const defaultCache: BacklinksCache = {
  get: getCached,
  set: setCached,
};

type BacklinksPageCacheInput = {
  target: string;
  scope?: BacklinksLookupInput["scope"];
  page: number;
  pageSize: number;
  sortField: string;
  sortOrder: string;
  filters: Record<string, unknown>;
  /** Backlinks rows only: DataForSEO result grouping. */
  mode?: string;
};

function createBacklinksService(cache: BacklinksCache = defaultCache) {
  return {
    async profileOverview(
      input: BacklinksLookupInput,
      billingCustomer: CustomerContext,
      // Lets a caller (e.g. the SAM agent) attribute the spend to its own credit
      // feature. Applied to the DataForSEO calls, not the cache key, so cached
      // results stay shared across callers.
    ) {
      const cacheKey = await buildCacheKey("backlinks:overview:v3", {
        ...buildTargetCacheInput(input, billingCustomer),
      });

      return profileBacklinksOverview(cache, cacheKey, input, billingCustomer);
    },
    async storedOverview(
      input: BacklinksLookupInput,
      billingCustomer: CustomerContext,
    ) {
      const cacheKey = await buildCacheKey("backlinks:overview:v3", {
        ...buildTargetCacheInput(input, billingCustomer),
      });
      return storedBacklinksOverview(cache, cacheKey);
    },
    async profileBacklinksPage(
      input: BacklinksRowsPageServiceInput,
      billingCustomer: CustomerContext,
      options?: BacklinksSpamFilterOptions,
    ) {
      const cacheKey = await buildPageCacheKey(
        "backlinks:rows-page:v3",
        input,
        billingCustomer,
        options,
      );

      return profileBacklinksRowsPage(
        cache,
        cacheKey,
        input,
        billingCustomer,
        options,
      );
    },
    async profileReferringDomainsPage(
      input: ReferringDomainsPageServiceInput,
      billingCustomer: CustomerContext,
      options?: BacklinksSpamFilterOptions,
    ) {
      const cacheKey = await buildPageCacheKey(
        "backlinks:referring-domains-page:v2",
        input,
        billingCustomer,
        options,
      );

      return profileReferringDomainsPage(
        cache,
        cacheKey,
        input,
        billingCustomer,
        options,
      );
    },
    async profileAnchorsPage(
      input: AnchorsPageServiceInput,
      billingCustomer: CustomerContext,
    ) {
      const cacheKey = await buildPageCacheKey(
        "backlinks:anchors-page:v1",
        input,
        billingCustomer,
      );

      return profileAnchorsPage(cache, cacheKey, input, billingCustomer);
    },
    async profileTopPagesPage(
      input: TopPagesPageServiceInput,
      billingCustomer: CustomerContext,
    ) {
      const cacheKey = await buildPageCacheKey(
        "backlinks:top-pages-page:v2",
        input,
        billingCustomer,
      );

      return profileTopPagesPage(cache, cacheKey, input, billingCustomer);
    },
  } as const;
}

function buildTargetCacheInput(
  input: BacklinksLookupInput,
  billingCustomer: CustomerContext,
) {
  const normalizedTarget = normalizeBacklinksTarget(input.target, {
    scope: input.scope,
  });

  return {
    organizationId: billingCustomer.organizationId,
    target: normalizedTarget.apiTarget,
    scope: normalizedTarget.scope,
    // Subfolder scope keeps the hostname as the API target, so the path must
    // separate cache entries.
    path: normalizedTarget.path,
    // Same hostname, different result set — and keeping it in the key retires
    // entries written before scopes could exclude subdomains.
    includeSubdomains: normalizedTarget.includeSubdomains,
  };
}

async function buildPageCacheKey(
  prefix: string,
  input: BacklinksPageCacheInput,
  billingCustomer: CustomerContext,
  options?: BacklinksSpamFilterOptions,
): Promise<string> {
  return buildCacheKey(prefix, {
    ...buildTargetCacheInput(input, billingCustomer),
    page: input.page,
    pageSize: input.pageSize,
    sortField: input.sortField,
    sortOrder: input.sortOrder,
    filters: input.filters,
    ...(input.mode ? { mode: input.mode } : {}),
    hideSpam: String(options?.hideSpam ?? true),
  });
}

export const BacklinksService = createBacklinksService();
export { createBacklinksService };
