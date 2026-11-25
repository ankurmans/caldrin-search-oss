import { z } from "zod";
import {
  isSupportedLanguageCode,
  isSupportedLocationCode,
} from "@/shared/keyword-locations";

// Shared by the server functions, the MCP tools and the table, so the page and
// an agent filter the same way.

export const GAP_SORT_FIELDS = [
  "searchVolume",
  "keywordDifficulty",
  "bestPosition",
  "targetPosition",
  "competitorCount",
  "keyword",
  "observedAt",
] as const;
export type GapSortField = (typeof GAP_SORT_FIELDS)[number];

export const GAP_KINDS = ["all", "missing", "outranked"] as const;
export const GAP_STATUSES = ["open", "watching", "dismissed", "all"] as const;
export const GAP_INTENTS = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
] as const;
export const GAP_DEPTHS = [100, 250, 500, 1000] as const;
export const MAX_GAP_COMPETITORS = 5;
export const GAP_PAGE_SIZES = [25, 50, 100, 200] as const;

const count = z.number().int().min(0).max(100_000_000);

const keywordGapFiltersSchema = z.object({
  // Latest run when omitted.
  runId: z.string().min(1).optional(),
  search: z.string().trim().max(100).optional(),
  kind: z.enum(GAP_KINDS).default("all"),
  status: z.enum(GAP_STATUSES).default("open"),
  intent: z.enum(GAP_INTENTS).optional(),
  competitor: z.string().trim().max(253).optional(),
  minVolume: count.optional(),
  maxVolume: count.optional(),
  minKd: z.number().int().min(0).max(100).optional(),
  maxKd: z.number().int().min(0).max(100).optional(),
  minPosition: z.number().int().min(1).max(100).optional(),
  maxPosition: z.number().int().min(1).max(100).optional(),
  minCompetitors: z.number().int().min(1).max(MAX_GAP_COMPETITORS).optional(),
  hasOpportunity: z.boolean().optional(),
});

export const keywordGapQuerySchema = keywordGapFiltersSchema.extend({
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
  sortBy: z.enum(GAP_SORT_FIELDS).default("searchVolume"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
export type KeywordGapQuery = z.infer<typeof keywordGapQuerySchema>;

const locationCodeField = z
  .number()
  .int()
  .refine(isSupportedLocationCode, "Unsupported location code");
const languageCodeField = z
  .string()
  .refine(isSupportedLanguageCode, "Unsupported language code");

// A market is a Google location plus a language, validated against the codes
// the provider accepts so a guess never reaches a paid call.
export const explorerMarketSchema = z.object({
  locationCode: locationCodeField.optional(),
  languageCode: languageCodeField.optional(),
});
export const competitorMarketSchema = z.object({
  locationCode: locationCodeField,
  languageCode: languageCodeField,
});

export const keywordGapRunInputSchema = z.object({
  // Bare hostnames; empty uses every saved competitor, up to five.
  competitors: z.array(z.string().trim().min(1).max(253)).max(10).default([]),
  locationCode: locationCodeField.optional(),
  languageCode: languageCodeField.optional(),
  rowsPerCompetitor: z
    .number()
    .int()
    .refine((n) => GAP_DEPTHS.some((depth) => depth === n), "Unsupported depth")
    .default(100),
  includeOutranked: z.boolean().default(false),
});
export type KeywordGapRunInput = z.infer<typeof keywordGapRunInputSchema>;
