import {
  DEFAULT_DOMAIN_KEYWORDS_PAGE_SIZE,
  type DOMAIN_VIEWS,
  type DomainSearchParams,
} from "@/types/schemas/domain";
import {
  DEFAULT_LOCATION_CODE,
  isLabsLocationCode,
} from "@/client/features/keywords/locations";
import type { ProjectMarket } from "@/client/features/projects/types";
import {
  isSameSite,
  siteHostname,
} from "@/client/features/domain/siteExplorerDomain";
import {
  EMPTY_DOMAIN_FILTERS,
  type DomainActiveTab,
  type DomainFilterValues,
  type DomainSortMode,
  type KeywordsFilterValues,
  type PagesFilterValues,
  type SortOrder,
} from "@/client/features/domain/types";
import {
  KEYWORD_FILTER_FIELDS,
  PAGE_FILTER_FIELDS,
  PAGE_SEARCH_PARAM_BY_FIELD,
} from "@/client/features/domain/domainFilterUtils";
import {
  defaultScopeForPath,
  isScopeAllowedForInput,
  type ResearchScope,
} from "@/shared/researchScope";
import {
  getResearchInputPath,
  resolveSortOrder,
  toSortMode,
  toSortOrder,
} from "./utils";

export type DomainOverviewRouteState = {
  /** The domain being explored: the one asked for, else the project's own. */
  domain: string;
  /** The project's own hostname, or "" when it has none or it is invalid. */
  ownDomain: string;
  /** Whether the explored domain is the project's own site. */
  isOwn: boolean;
  /** Whether the URL named a domain, rather than the project's own default. */
  hasRequestedDomain: boolean;
  scope: ResearchScope;
  sort: DomainSortMode;
  order: SortOrder;
  view: (typeof DOMAIN_VIEWS)[number];
  tab: DomainActiveTab;
  defaultLocationCode: number;
  locationCode: number;
  sentLocationCode: number | undefined;
  page: number;
  pageSize: number;
  appliedFilters: DomainFilterValues;
  appliedPageFilters: PagesFilterValues;
  intent: DomainSearchParams["intent"];
  change: DomainSearchParams["change"];
  hasAppliedKeywordFilters: boolean;
  hasAppliedPageFilters: boolean;
};

function resolveScope(
  search: DomainSearchParams,
  domain: string,
): ResearchScope {
  const path = getResearchInputPath(domain);
  if (search.scope && isScopeAllowedForInput(search.scope, path)) {
    return search.scope;
  }
  // Legacy param: pre-scope URLs encoded "Include subdomains" here.
  if (search.subdomains != null) {
    return search.subdomains ? "subdomains" : "domain";
  }
  return defaultScopeForPath(path);
}

function numberToFilterString(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value);
}

export function getDomainRouteState(
  search: DomainSearchParams,
  projectMarket?: ProjectMarket & { domain?: string | null },
): DomainOverviewRouteState {
  const ownDomain = siteHostname(projectMarket?.domain) ?? "";
  const requested = (search.domain ?? "").trim();
  const domain = requested || ownDomain;
  const normalizedSort = toSortMode(search.sort ?? null) ?? "traffic";
  const defaultLocationCode =
    projectMarket && isLabsLocationCode(projectMarket.locationCode)
      ? projectMarket.locationCode
      : DEFAULT_LOCATION_CODE;
  // Domain analytics is Labs-backed; Google-Ads-only countries aren't valid.
  const normalizedLocationCode =
    search.loc != null && isLabsLocationCode(search.loc)
      ? search.loc
      : defaultLocationCode;

  return {
    domain,
    ownDomain,
    isOwn: isSameSite(domain, ownDomain),
    hasRequestedDomain: requested !== "",
    scope: resolveScope(search, domain),
    sort: normalizedSort,
    order: resolveSortOrder(normalizedSort, toSortOrder(search.order ?? null)),
    view: search.view ?? defaultView(search),
    tab: search.tab ?? "keywords",
    defaultLocationCode,
    locationCode: normalizedLocationCode,
    // A non-Labs `loc` is dropped so the server uses the same default the
    // location select shows.
    sentLocationCode:
      search.loc != null && isLabsLocationCode(search.loc)
        ? search.loc
        : undefined,
    page: search.page != null && search.page > 0 ? search.page : 1,
    pageSize: search.size ?? DEFAULT_DOMAIN_KEYWORDS_PAGE_SIZE,
    appliedFilters: {
      include: search.include ?? EMPTY_DOMAIN_FILTERS.include,
      exclude: search.exclude ?? EMPTY_DOMAIN_FILTERS.exclude,
      minTraffic: numberToFilterString(search.minTraffic),
      maxTraffic: numberToFilterString(search.maxTraffic),
      minVol: numberToFilterString(search.minVol),
      maxVol: numberToFilterString(search.maxVol),
      minCpc: numberToFilterString(search.minCpc),
      maxCpc: numberToFilterString(search.maxCpc),
      minKd: numberToFilterString(search.minKd),
      maxKd: numberToFilterString(search.maxKd),
      minRank: numberToFilterString(search.minRank),
      maxRank: numberToFilterString(search.maxRank),
    },
    appliedPageFilters: {
      include: search.pInclude ?? EMPTY_DOMAIN_FILTERS.include,
      exclude: search.pExclude ?? EMPTY_DOMAIN_FILTERS.exclude,
      minTraffic: numberToFilterString(search.pMinTraffic),
      maxTraffic: numberToFilterString(search.pMaxTraffic),
      minVol: numberToFilterString(search.pMinVol),
      maxVol: numberToFilterString(search.pMaxVol),
    },
    intent: search.intent,
    change: search.change,
    hasAppliedKeywordFilters: hasKeywordSearchFilters(search),
    hasAppliedPageFilters: hasPageSearchFilters(search),
  };
}

/** Links made before the views existed carry table params and want the tables. */
export function defaultView(
  search: DomainSearchParams,
): (typeof DOMAIN_VIEWS)[number] {
  const wantsTables =
    search.tab != null ||
    search.sort != null ||
    search.page != null ||
    search.size != null ||
    search.intent != null ||
    search.change != null ||
    hasKeywordSearchFilters(search) ||
    hasPageSearchFilters(search);
  return wantsTables ? "organic" : "overview";
}

function hasKeywordSearchFilters(search: DomainSearchParams): boolean {
  return KEYWORD_FILTER_FIELDS.some(
    (key: keyof KeywordsFilterValues) => search[key] != null,
  );
}

function hasPageSearchFilters(search: DomainSearchParams): boolean {
  return PAGE_FILTER_FIELDS.some(
    (key) => search[PAGE_SEARCH_PARAM_BY_FIELD[key]] != null,
  );
}
