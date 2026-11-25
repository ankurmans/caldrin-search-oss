import { useQuery } from "@tanstack/react-query";
import { getErrorCode } from "@/client/lib/error-messages";
import {
  getDomainOverview,
  getStoredDomainOverview,
} from "@/serverFunctions/domain";
import type { ResearchScope } from "@/shared/researchScope";

type Input = {
  projectId: string;
  domain: string;
  scope: ResearchScope;
  locationCode: number | undefined;
};

/**
 * The overview already read for this domain, or null. Never starts a provider
 * charge, so opening a domain only ever shows what is already paid for.
 */
export function useStoredDomainOverviewQuery(input: Input) {
  const trimmedDomain = input.domain.trim();

  return useQuery({
    enabled: trimmedDomain !== "",
    queryKey: [
      "domain-overview-stored",
      input.projectId,
      trimmedDomain,
      input.scope,
      input.locationCode,
    ],
    queryFn: () =>
      getStoredDomainOverview({
        data: {
          projectId: input.projectId,
          domain: trimmedDomain,
          scope: input.scope,
          locationCode: input.locationCode,
        },
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** The paid read. `enabled` stays false until a person asks for the analysis. */
export function useDomainOverviewQuery(input: Input & { enabled: boolean }) {
  const trimmedDomain = input.domain.trim();

  return useQuery({
    enabled: input.enabled && trimmedDomain !== "",
    queryKey: [
      "domain-overview",
      input.projectId,
      trimmedDomain,
      input.scope,
      input.locationCode,
    ],
    queryFn: () =>
      getDomainOverview({
        data: {
          projectId: input.projectId,
          domain: trimmedDomain,
          scope: input.scope,
          locationCode: input.locationCode,
        },
      }),
    staleTime: 5 * 60_000,
    // Out of credits, a retry cannot succeed, so show the get-credits card now.
    retry: (failureCount, error) =>
      failureCount < 3 && getErrorCode(error) !== "TRIAL_ENDED",
  });
}
