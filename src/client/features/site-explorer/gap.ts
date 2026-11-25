import { z } from "zod";
import type { getKeywordGap } from "@/serverFunctions/site-explorer";
import {
  GAP_INTENTS,
  GAP_KINDS,
  GAP_PAGE_SIZES,
  GAP_SORT_FIELDS,
  GAP_STATUSES,
  type GapSortField,
  type KeywordGapQuery,
} from "@/types/schemas/keyword-gap";

export const KEYWORD_GAP_TABLE_KEY = "keyword-gap";

export const gapKeys = {
  table: (projectId: string) => ["keywordGap", projectId] as const,
  runs: (projectId: string) => ["keywordGapRuns", projectId] as const,
  competitors: (projectId: string) =>
    ["explorerCompetitors", projectId] as const,
  views: (projectId: string) => ["explorerViews", projectId] as const,
};

export const KIND_LABELS = {
  all: "All types",
  missing: "Missing",
  outranked: "Outranked",
} as const;

export const STATUS_LABELS = {
  open: "Open",
  watching: "Watching",
  dismissed: "Dismissed",
  all: "Any status",
} as const;

export const INTENT_LABELS = {
  informational: "Informational",
  commercial: "Commercial",
  transactional: "Transactional",
  navigational: "Navigational",
} as const;

export function intentLabel(intent: string | null): string {
  const found = GAP_INTENTS.find((value) => value === intent);
  return found ? INTENT_LABELS[found] : "-";
}

// Filter inputs are strings so a half-typed number never reaches the server.
export const filterStateSchema = z.object({
  search: z.string().max(100),
  kind: z.enum(GAP_KINDS),
  status: z.enum(GAP_STATUSES),
  intent: z.enum(GAP_INTENTS).nullable(),
  competitor: z.string().max(253).nullable(),
  minVolume: z.string().max(12),
  maxVolume: z.string().max(12),
  minKd: z.string().max(3),
  maxKd: z.string().max(3),
  minCompetitors: z.string().max(1),
});
export type GapFilterState = z.infer<typeof filterStateSchema>;

export const NO_FILTERS: GapFilterState = {
  search: "",
  kind: "all",
  status: "open",
  intent: null,
  competitor: null,
  minVolume: "",
  maxVolume: "",
  minKd: "",
  maxKd: "",
  minCompetitors: "",
};

const viewConfigSchema = z.object({
  filters: filterStateSchema,
  sortBy: z.enum(GAP_SORT_FIELDS),
  sortDir: z.enum(["asc", "desc"]),
  pageSize: z
    .number()
    .refine((size) => GAP_PAGE_SIZES.some((allowed) => allowed === size)),
});
type GapViewConfig = z.infer<typeof viewConfigSchema>;

export function parseViewConfig(raw: string): GapViewConfig | null {
  try {
    const parsed = viewConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function whole(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

// The count of filters that differ from the default view.
export function activeFilterCount(filters: GapFilterState): number {
  let count = 0;
  if (filters.search.trim()) count++;
  if (filters.kind !== NO_FILTERS.kind) count++;
  if (filters.status !== NO_FILTERS.status) count++;
  if (filters.intent) count++;
  if (filters.competitor) count++;
  if (whole(filters.minVolume) !== undefined) count++;
  if (whole(filters.maxVolume) !== undefined) count++;
  if (whole(filters.minKd) !== undefined) count++;
  if (whole(filters.maxKd) !== undefined) count++;
  if (whole(filters.minCompetitors) !== undefined) count++;
  return count;
}

export function buildQuery(input: {
  filters: GapFilterState;
  runId: string | undefined;
  page: number;
  pageSize: number;
  sortBy: GapSortField;
  sortDir: "asc" | "desc";
}): KeywordGapQuery {
  const { filters } = input;
  return {
    runId: input.runId,
    search: filters.search.trim() || undefined,
    kind: filters.kind,
    status: filters.status,
    intent: filters.intent ?? undefined,
    competitor: filters.competitor ?? undefined,
    minVolume: whole(filters.minVolume),
    maxVolume: whole(filters.maxVolume),
    minKd: whole(filters.minKd),
    maxKd: whole(filters.maxKd),
    minCompetitors: whole(filters.minCompetitors),
    page: input.page,
    pageSize: input.pageSize,
    sortBy: input.sortBy,
    sortDir: input.sortDir,
  };
}

const COLUMNS_STORAGE_KEY = "caldrin.keywordGap.hiddenColumns";

export function readHiddenColumns(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = z.record(z.string(), z.boolean()).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function writeHiddenColumns(hidden: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(hidden));
  } catch {
    // Private windows and blocked storage just forget the choice.
  }
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `$${value.toFixed(value !== 0 && Math.abs(value) < 1 ? 3 : 2)}`;
}

export type GapData = NonNullable<Awaited<ReturnType<typeof getKeywordGap>>>;
export type GapRow = GapData["rows"][number];
