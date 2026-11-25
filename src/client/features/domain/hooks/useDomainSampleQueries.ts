import { useQuery } from "@tanstack/react-query";
import { getErrorCode } from "@/client/lib/error-messages";
import {
  getDomainKeywordSummary,
  getDomainPagesSummary,
} from "@/serverFunctions/domain";
import type { ResearchScope } from "@/shared/researchScope";

type Input = {
  projectId: string;
  domain: string;
  scope: ResearchScope;
  locationCode: number | undefined;
  /** False until the view that shows the result is open. */
  enabled?: boolean;
};

// Both summaries read a 100-row provider sample the server caches for 12
// hours, so they never refetch on focus.
function sampleQueryOptions(input: Input) {
  const domain = input.domain.trim();
  return {
    enabled: domain !== "" && input.enabled !== false,
    data: {
      projectId: input.projectId,
      domain,
      scope: input.scope,
      locationCode: input.locationCode,
    },
    key: [input.projectId, domain, input.scope, input.locationCode],
    staleTime: 12 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: (failureCount: number, error: unknown) =>
      failureCount < 2 && getErrorCode(error) !== "TRIAL_ENDED",
  };
}

export function useDomainKeywordSummaryQuery(input: Input) {
  const { key, data, ...options } = sampleQueryOptions(input);
  return useQuery({
    ...options,
    queryKey: ["domain-keyword-summary", ...key],
    queryFn: () => getDomainKeywordSummary({ data }),
  });
}

export function useDomainPagesSummaryQuery(input: Input) {
  const { key, data, ...options } = sampleQueryOptions(input);
  return useQuery({
    ...options,
    queryKey: ["domain-pages-summary", ...key],
    queryFn: () => getDomainPagesSummary({ data }),
  });
}
