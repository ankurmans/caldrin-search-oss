import { queryOptions } from "@tanstack/react-query";
import {
  getCitationGaps,
  getCitationSource,
} from "@/serverFunctions/citation-gaps";
import type { AiEngine } from "@/shared/ai-visibility";

export interface CitationGapFilters {
  days: 7 | 28 | 90;
  engines: AiEngine[] | null;
  topic: string | null;
}

export const DEFAULT_CITATION_GAP_FILTERS: CitationGapFilters = {
  days: 28,
  engines: null,
  topic: null,
};

export const citationGapsKey = (projectId: string) => [
  "citationGaps",
  projectId,
];

export const citationGapsQueryOptions = (
  projectId: string,
  filters: CitationGapFilters,
) =>
  queryOptions({
    queryKey: [...citationGapsKey(projectId), "analysis", filters],
    queryFn: () => getCitationGaps({ data: { projectId, ...filters } }),
  });

export const citationSourceQueryOptions = (
  projectId: string,
  filters: CitationGapFilters,
  domain: string,
) =>
  queryOptions({
    queryKey: [...citationGapsKey(projectId), "source", filters, domain],
    queryFn: () =>
      getCitationSource({ data: { projectId, ...filters, domain } }),
  });
