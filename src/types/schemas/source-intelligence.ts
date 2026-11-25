import { z } from "zod";
import { AI_ENGINE_LABELS } from "@/shared/ai-visibility";
import { aiEngineSchema, aiProjectSchema } from "./ai-visibility";

export const SOURCE_VIEWS = ["sources", "domains", "queries"] as const;
export type SourceView = (typeof SOURCE_VIEWS)[number];

export const SOURCE_SORT_FIELDS = [
  "retrieved",
  "cited",
  "answers",
  "lastSeen",
  "name",
] as const;
export type SourceSortField = (typeof SOURCE_SORT_FIELDS)[number];

export const SOURCE_PAGE_SIZES = [25, 50, 100] as const;

export const sourceFiltersSchema = z.object({
  ownership: z.enum(["own", "competitor", "third_party", "unknown"]).nullish(),
  appearance: z.enum(["cited", "retrieved"]).nullish(),
  promptId: z.string().min(1).max(100).nullish(),
  locationCode: z.number().int().positive().nullish(),
  languageCode: z.string().min(2).max(12).nullish(),
  days: z
    .union([z.literal(7), z.literal(28), z.literal(90), z.literal(365)])
    .default(90),
  engine: aiEngineSchema.nullish(),
  engines: z
    .array(aiEngineSchema)
    .max(aiEngineSchema.options.length)
    .optional(),
  // The prompt's topic, which is how tracked prompts are grouped.
  promptGroup: z.string().trim().min(1).max(100).nullish(),
  // A tracked brand's domain: only answers that mention or cite that brand.
  brandDomain: z.string().trim().min(1).max(253).nullish(),
  sourceDomain: z.string().trim().min(1).max(253).nullish(),
  hideDismissed: z.boolean().default(true),
});
export type SourceFilters = z.infer<typeof sourceFiltersSchema>;

export const sourceSearchSchema = sourceFiltersSchema.partial().extend({
  view: z.enum(SOURCE_VIEWS).optional(),
  by: z.enum(["prompt", "query"]).optional(),
  answer: z.string().min(1).max(100).optional(),
});

export const fanOutAnswerSchema = aiProjectSchema.extend({
  observationId: z.string().min(1).max(100),
});
export const fanOutOpportunitySchema = fanOutAnswerSchema.extend({
  pageUrl: z.url().max(2048).optional(),
});

export const sourceQuerySchema = aiProjectSchema.extend({
  filters: sourceFiltersSchema.default({ days: 90, hideDismissed: true }),
  view: z.enum(SOURCE_VIEWS).default("sources"),
  sortBy: z.enum(SOURCE_SORT_FIELDS).default("cited"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(50),
});
export type SourceQuery = z.infer<typeof sourceQuerySchema>;

export const sourceDetailSchema = aiProjectSchema.extend({
  filters: sourceFiltersSchema.default({ days: 90, hideDismissed: true }),
  url: z.string().trim().min(1).max(16_384),
});

export const SOURCE_ACTIONS = [
  "content",
  "third_party",
  "link_prospect",
] as const;
export const sourceActionSchema = aiProjectSchema.extend({
  filters: sourceFiltersSchema.default({ days: 90, hideDismissed: true }),
  url: z.string().trim().min(1).max(16_384),
  action: z.enum(SOURCE_ACTIONS),
});

export const sourceAnalyseSchema = aiProjectSchema.extend({
  url: z.string().trim().min(1).max(16_384),
  // Without confirm the call prices the reading and fetches nothing.
  confirm: z.boolean().default(false),
  refresh: z.boolean().default(false),
});

export const sourceAnalysisReadSchema = aiProjectSchema.extend({
  url: z.string().trim().min(1).max(16_384),
});

export const sourceDecisionSchema = aiProjectSchema.extend({
  domain: z.string().trim().min(1).max(253),
  decision: z.enum(["monitor", "dismiss", "clear"]),
});

/** The shared label for a known engine, else the raw id. */
export function engineLabel(engine: string) {
  const known = aiEngineSchema.options.find((e) => e === engine);
  return known ? AI_ENGINE_LABELS[known] : engine;
}

export type Approach =
  | "owned_content_gap"
  | "comparison_opportunity"
  | "independent_source_opportunity"
  | "already_covered"
  | "no_clear_gap";

export const APPROACH_LABELS: Record<Approach, string> = {
  owned_content_gap: "Owned content gap",
  comparison_opportunity: "Comparison opportunity",
  independent_source_opportunity: "Independent source opportunity",
  already_covered: "Brand already named",
  no_clear_gap: "No clear gap",
};
