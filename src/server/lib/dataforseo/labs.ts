/* eslint-disable max-lines -- one file per DataForSEO section (see index.ts); Labs spans keyword, domain and intersection calls */
import { z } from "zod";
import { dataforseoPost } from "@/server/lib/dataforseo/core";
import {
  assertOk,
  buildTaskBilling,
  parseTaskItems,
  type DataforseoApiResponse,
  type DataforseoItemsResult,
  type DataforseoItemsTask,
  type DataforseoTaskLike,
} from "@/server/lib/dataforseo/envelope";

// Labs payload types: the fields the app reads, typed honestly (the wire nulls
// any of them); the index signature carries everything else through untyped,
// like the SDK's item models did. These are claims about the payload, not
// validation — fields that must hold get a Zod schema (see below).

export interface LabsMonthlySearch {
  year?: number | null;
  month?: number | null;
  search_volume?: number | null;
  [key: string]: unknown;
}

export interface LabsKeywordInfo {
  search_volume?: number | null;
  cpc?: number | null;
  /** 0-1 paid-competition ratio (Google Ads reports a 0-100 index instead). */
  competition?: number | null;
  competition_level?: string | null;
  monthly_searches?: LabsMonthlySearch[] | null;
  [key: string]: unknown;
}

export interface LabsKeywordDataItem {
  keyword?: string | null;
  keyword_info?: LabsKeywordInfo | null;
  keyword_info_normalized_with_clickstream?: LabsKeywordInfo | null;
  keyword_properties?: {
    keyword_difficulty?: number | null;
    [key: string]: unknown;
  } | null;
  search_intent_info?: {
    main_intent?: string | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/** keyword_overview items share the keyword-data field surface. */
export type KeywordOverviewItem = LabsKeywordDataItem;

/** related_keywords wraps the keyword payload one level deeper. */
type RelatedKeywordItem = {
  keyword_data?: LabsKeywordDataItem | null;
  [key: string]: unknown;
};

/** Per-channel ranking metrics. Position buckets count keywords by rank. */
export type LabsChannelMetrics = {
  etv?: number | null;
  count?: number | null;
  /** Provider estimate of what the same traffic would cost as paid clicks. */
  estimated_paid_traffic_cost?: number | null;
  pos_1?: number | null;
  pos_2_3?: number | null;
  pos_4_10?: number | null;
  pos_11_20?: number | null;
  pos_21_30?: number | null;
  pos_31_40?: number | null;
  pos_41_50?: number | null;
  pos_51_60?: number | null;
  pos_61_70?: number | null;
  pos_71_80?: number | null;
  pos_81_90?: number | null;
  pos_91_100?: number | null;
  is_new?: number | null;
  is_up?: number | null;
  is_down?: number | null;
  /** Reported by historical_rank_overview only. */
  is_lost?: number | null;
  [key: string]: unknown;
};

type LabsMetricsBlock = {
  organic?: LabsChannelMetrics | null;
  paid?: LabsChannelMetrics | null;
  [key: string]: unknown;
};

type HistoricalRankOverviewItem = {
  year?: number | null;
  month?: number | null;
  metrics?: LabsMetricsBlock | null;
  [key: string]: unknown;
};

type DomainMetricsItem = {
  metrics?: LabsMetricsBlock | null;
  [key: string]: unknown;
};

export interface RelevantPagesItem {
  page_address?: string | null;
  metrics?: LabsMetricsBlock | null;
  [key: string]: unknown;
}

type SerpCompetitorItem = {
  domain?: string | null;
  avg_position?: number | null;
  median_position?: number | null;
  visibility?: number | null;
  etv?: number | null;
  keywords_count?: number | null;
  [key: string]: unknown;
};

// Ranked keywords is the one Labs endpoint the SDK types loosely: its
// `ranked_serp_element.serp_item` is the base element item, so the url / etv /
// rank fields we read are untyped (`any`). Keep a focused schema so the
// domain-keyword mapper stays type-safe.
const rankedSerpItemSchema = z
  .object({
    url: z.string().nullable().optional(),
    relative_url: z.string().nullable().optional(),
    rank_absolute: z.number().nullable().optional(),
    etv: z.number().nullable().optional(),
    rank_changes: z
      .object({
        previous_rank_absolute: z.number().nullable().optional(),
        is_new: z.boolean().nullable().optional(),
        is_up: z.boolean().nullable().optional(),
        is_down: z.boolean().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const domainRankedKeywordItemSchema = z
  .object({
    keyword_data: z
      .object({
        keyword: z.string().nullable().optional(),
        keyword_info: z
          .object({
            search_volume: z.number().nullable().optional(),
            cpc: z.number().nullable().optional(),
            keyword_difficulty: z.number().nullable().optional(),
            monthly_searches: z
              .array(
                z
                  .object({
                    year: z.number().nullable().optional(),
                    month: z.number().nullable().optional(),
                    search_volume: z.number().nullable().optional(),
                  })
                  .passthrough(),
              )
              .nullable()
              .optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        search_intent_info: z
          .object({ main_intent: z.string().nullable().optional() })
          .passthrough()
          .nullable()
          .optional(),
        serp_info: z
          .object({
            serp_item_types: z.array(z.string()).nullable().optional(),
            last_updated_time: z.string().nullable().optional(),
            previous_updated_time: z.string().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        keyword_properties: z
          .object({
            keyword_difficulty: z.number().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    ranked_serp_element: z
      .object({
        serp_item: rankedSerpItemSchema.nullable().optional(),
        url: z.string().nullable().optional(),
        relative_url: z.string().nullable().optional(),
        rank_absolute: z.number().nullable().optional(),
        etv: z.number().nullable().optional(),
        last_updated_time: z.string().nullable().optional(),
        previous_updated_time: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    keyword: z.string().nullable().optional(),
  })
  .passthrough();

export type DomainRankedKeywordItem = z.infer<
  typeof domainRankedKeywordItemSchema
>;

type DataforseoLabsItemType =
  | "organic"
  | "paid"
  | "featured_snippet"
  | "local_pack"
  | "ai_overview_reference";

export async function fetchRelatedKeywords(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  depth?: number;
  includeClickstreamData?: boolean;
  ignoreSynonyms?: boolean;
}): Promise<DataforseoApiResponse<RelatedKeywordItem[]>> {
  const response = await dataforseoPost<
    DataforseoItemsTask<RelatedKeywordItem>
  >("/v3/dataforseo_labs/google/related_keywords/live", [
    {
      keyword: input.keyword,
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      depth: input.depth ?? 3,
      ignore_synonyms: input.ignoreSynonyms ?? false,
      // Clickstream-refined volumes DOUBLE the request cost, so they are
      // opt-in — see docs/maintainers/specs/0004-keyword-data-source-routing.md.
      include_clickstream_data: input.includeClickstreamData ?? false,
      include_serp_info: false,
    },
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

/** keyword_suggestions returns the seed keyword's own data beside `items`. */
type KeywordSuggestionsTask = DataforseoTaskLike & {
  result?: Array<
    DataforseoItemsResult<LabsKeywordDataItem> & {
      seed_keyword_data?: LabsKeywordDataItem | null;
    }
  >;
};

export async function fetchKeywordSuggestions(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  includeClickstreamData?: boolean;
  ignoreSynonyms?: boolean;
  filters?: unknown[];
}): Promise<DataforseoApiResponse<LabsKeywordDataItem[]>> {
  const response = await dataforseoPost<KeywordSuggestionsTask>(
    "/v3/dataforseo_labs/google/keyword_suggestions/live",
    [
      {
        keyword: input.keyword,
        location_code: input.locationCode,
        language_code: input.languageCode,
        limit: input.limit,
        include_clickstream_data: input.includeClickstreamData ?? false,
        include_serp_info: false,
        // DataForSEO does not apply `filters` to the seed keyword, so only an
        // unfiltered call asks for it.
        include_seed_keyword: !input.filters,
        ignore_synonyms: input.ignoreSynonyms ?? false,
        exact_match: false,
        filters: input.filters,
      },
    ],
  );
  const task = assertOk(response);
  const result = task.result?.[0];
  const items = result?.items ?? [];
  // The seed keyword goes first, within the limit, so the keyword that was
  // searched is always one of the rows.
  const seed = result?.seed_keyword_data;
  return {
    data: seed ? [seed, ...items].slice(0, input.limit) : items,
    billing: buildTaskBilling(task),
  };
}

export async function fetchKeywordIdeas(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  includeClickstreamData?: boolean;
  ignoreSynonyms?: boolean;
}): Promise<DataforseoApiResponse<LabsKeywordDataItem[]>> {
  const response = await dataforseoPost<
    DataforseoItemsTask<LabsKeywordDataItem>
  >("/v3/dataforseo_labs/google/keyword_ideas/live", [
    {
      keywords: [input.keyword],
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      include_clickstream_data: input.includeClickstreamData ?? false,
      include_serp_info: false,
      ignore_synonyms: input.ignoreSynonyms ?? false,
      closely_variants: false,
    },
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

export async function fetchDomainRankOverview(input: {
  target: string;
  locationCode: number;
  languageCode: string;
}): Promise<DataforseoApiResponse<DomainMetricsItem[]>> {
  const response = await dataforseoPost<DataforseoItemsTask<DomainMetricsItem>>(
    "/v3/dataforseo_labs/google/domain_rank_overview/live",
    [
      {
        target: input.target,
        location_code: input.locationCode,
        language_code: input.languageCode,
        limit: 1,
      },
    ],
  );
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

/**
 * One item per month, newest first. The window runs from `dateFrom` to
 * `dateTo` (YYYY-MM-DD); omitted, the provider returns its default span.
 */
export async function fetchHistoricalRankOverview(input: {
  target: string;
  locationCode: number;
  languageCode: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<DataforseoApiResponse<HistoricalRankOverviewItem[]>> {
  const response = await dataforseoPost<
    DataforseoItemsTask<HistoricalRankOverviewItem>
  >("/v3/dataforseo_labs/google/historical_rank_overview/live", [
    {
      target: input.target,
      location_code: input.locationCode,
      language_code: input.languageCode,
      date_from: input.dateFrom,
      date_to: input.dateTo,
    },
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

type RankedKeywordsPage = {
  items: DomainRankedKeywordItem[];
  totalCount: number | null;
};

export async function fetchRankedKeywords(input: {
  target: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  offset?: number;
  orderBy?: string[];
  filters?: unknown[];
  itemTypes?: DataforseoLabsItemType[];
}): Promise<DataforseoApiResponse<RankedKeywordsPage>> {
  // Note: ranked_keywords has no include_subdomains parameter — a domain
  // target always covers the hostname plus its subdomains. Narrower scopes
  // are expressed through `filters` (see researchScopeFilters.ts).
  const response = await dataforseoPost<DataforseoItemsTask<unknown>>(
    "/v3/dataforseo_labs/google/ranked_keywords/live",
    [
      {
        target: input.target,
        location_code: input.locationCode,
        language_code: input.languageCode,
        limit: input.limit,
        offset: input.offset,
        order_by: input.orderBy,
        filters: input.filters,
        item_types: input.itemTypes,
      },
    ],
  );
  const task = assertOk(response);
  return {
    data: {
      items: parseTaskItems(
        "google-ranked-keywords-live",
        task,
        domainRankedKeywordItemSchema,
      ),
      totalCount: task.result?.[0]?.total_count ?? null,
    },
    billing: buildTaskBilling(task),
  };
}

type RelevantPagesPage = {
  items: RelevantPagesItem[];
  totalCount: number | null;
};

export async function fetchRelevantPages(input: {
  target: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  offset?: number;
  orderBy?: string[];
  filters?: unknown[];
}): Promise<DataforseoApiResponse<RelevantPagesPage>> {
  const response = await dataforseoPost<DataforseoItemsTask<RelevantPagesItem>>(
    "/v3/dataforseo_labs/google/relevant_pages/live",
    [
      {
        target: input.target,
        location_code: input.locationCode,
        language_code: input.languageCode,
        limit: input.limit,
        offset: input.offset,
        order_by: input.orderBy,
        filters: input.filters,
      },
    ],
  );
  const task = assertOk(response);
  return {
    data: {
      items: task.result?.[0]?.items ?? [],
      totalCount: task.result?.[0]?.total_count ?? null,
    },
    billing: buildTaskBilling(task),
  };
}

export async function fetchKeywordOverview(input: {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  includeClickstreamData?: boolean;
}): Promise<DataforseoApiResponse<KeywordOverviewItem[]>> {
  const response = await dataforseoPost<
    DataforseoItemsTask<KeywordOverviewItem>
  >("/v3/dataforseo_labs/google/keyword_overview/live", [
    {
      keywords: input.keywords,
      location_code: input.locationCode,
      language_code: input.languageCode,
      include_clickstream_data: input.includeClickstreamData ?? false,
    },
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

export async function fetchSerpCompetitors(input: {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  itemTypes?: DataforseoLabsItemType[];
  includeSubdomains?: boolean;
  limit: number;
  offset?: number;
}): Promise<DataforseoApiResponse<SerpCompetitorItem[]>> {
  const response = await dataforseoPost<
    DataforseoItemsTask<SerpCompetitorItem>
  >("/v3/dataforseo_labs/google/serp_competitors/live", [
    {
      keywords: input.keywords,
      location_code: input.locationCode,
      language_code: input.languageCode,
      item_types: input.itemTypes,
      include_subdomains: input.includeSubdomains,
      limit: input.limit,
      offset: input.offset,
    },
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

// domain_intersection compares exactly two targets. With intersections:false it
// returns the keywords target1 ranks for and target2 does not; with true, the
// keywords both rank for, each side's element beside the other.
const intersectionSerpElementSchema = z
  .object({
    rank_group: z.number().nullable().optional(),
    rank_absolute: z.number().nullable().optional(),
    url: z.string().nullable().optional(),
    etv: z.number().nullable().optional(),
  })
  .passthrough();

const domainIntersectionItemSchema = z
  .object({
    keyword_data: z
      .object({
        keyword: z.string().nullable().optional(),
        keyword_info: z
          .object({
            search_volume: z.number().nullable().optional(),
            cpc: z.number().nullable().optional(),
            last_updated_time: z.string().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        keyword_properties: z
          .object({ keyword_difficulty: z.number().nullable().optional() })
          .passthrough()
          .nullable()
          .optional(),
        search_intent_info: z
          .object({ main_intent: z.string().nullable().optional() })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    first_domain_serp_element: intersectionSerpElementSchema
      .nullable()
      .optional(),
    second_domain_serp_element: intersectionSerpElementSchema
      .nullable()
      .optional(),
  })
  .passthrough();

export type DomainIntersectionItem = z.infer<
  typeof domainIntersectionItemSchema
>;

type DomainIntersectionPage = {
  items: DomainIntersectionItem[];
  totalCount: number | null;
};

export async function fetchDomainIntersection(input: {
  target1: string;
  target2: string;
  intersections: boolean;
  locationCode: number;
  languageCode: string;
  limit: number;
  offset?: number;
  orderBy?: string[];
  filters?: unknown[];
}): Promise<DataforseoApiResponse<DomainIntersectionPage>> {
  const response = await dataforseoPost<DataforseoItemsTask<unknown>>(
    "/v3/dataforseo_labs/google/domain_intersection/live",
    [
      {
        target1: input.target1,
        target2: input.target2,
        intersections: input.intersections,
        location_code: input.locationCode,
        language_code: input.languageCode,
        limit: input.limit,
        offset: input.offset,
        order_by: input.orderBy,
        filters: input.filters,
        item_types: ["organic"],
      },
    ],
  );
  const task = assertOk(response);
  return {
    data: {
      items: parseTaskItems(
        "google-domain-intersection-live",
        task,
        domainIntersectionItemSchema,
      ),
      totalCount: task.result?.[0]?.total_count ?? null,
    },
    billing: buildTaskBilling(task),
  };
}

const competitorsDomainItemSchema = z
  .object({
    domain: z.string().nullable().optional(),
    avg_position: z.number().nullable().optional(),
    intersections: z.number().nullable().optional(),
    full_domain_metrics: z
      .object({
        organic: z
          .object({
            etv: z.number().nullable().optional(),
            count: z.number().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

type CompetitorsDomainItem = z.infer<typeof competitorsDomainItemSchema>;

export async function fetchCompetitorsDomain(input: {
  target: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  offset?: number;
}): Promise<
  DataforseoApiResponse<{
    items: CompetitorsDomainItem[];
    totalCount: number | null;
  }>
> {
  const response = await dataforseoPost<DataforseoItemsTask<unknown>>(
    "/v3/dataforseo_labs/google/competitors_domain/live",
    [
      {
        target: input.target,
        location_code: input.locationCode,
        language_code: input.languageCode,
        limit: input.limit,
        offset: input.offset,
        item_types: ["organic"],
        order_by: ["intersections,desc"],
        // Global platforms (video, social, encyclopedia) overlap with almost
        // every domain and bury the sites a reader can actually compare with.
        exclude_top_domains: true,
      },
    ],
  );
  const task = assertOk(response);
  return {
    data: {
      items: parseTaskItems(
        "google-competitors-domain-live",
        task,
        competitorsDomainItemSchema,
      ),
      totalCount: task.result?.[0]?.total_count ?? null,
    },
    billing: buildTaskBilling(task),
  };
}
