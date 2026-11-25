import type { getSourceIntelligence } from "@/serverFunctions/source-intelligence";
import type { SourceFilters } from "@/types/schemas/source-intelligence";

export type SourceData = Awaited<ReturnType<typeof getSourceIntelligence>>;
export type SourceTableRow = SourceData["rows"][number];
export type QueryTableRow = SourceData["queryRows"][number];

export const sourceKeys = {
  all: (projectId: string) => ["sourceIntelligence", projectId] as const,
  detail: (projectId: string, url: string, filters: SourceFilters) =>
    ["sourceIntelligenceDetail", projectId, url, filters] as const,
};

export const analysisKey = (projectId: string, url: string) =>
  ["sourceAnalysis", projectId, url] as const;

export const DEFAULT_FILTERS: SourceFilters = {
  days: 90,
  hideDismissed: true,
};

export const RELATION_LABELS: Record<SourceTableRow["relation"], string> = {
  retrieved_and_cited: "Retrieved and cited",
  retrieved_only: "Retrieved, not cited",
  cited_only: "Cited, no retrieval record",
};

export { engineLabel } from "@/types/schemas/source-intelligence";
