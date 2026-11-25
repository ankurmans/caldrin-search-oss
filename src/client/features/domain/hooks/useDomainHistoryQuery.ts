import { useQuery } from "@tanstack/react-query";
import { getErrorCode } from "@/client/lib/error-messages";
import {
  getDomainHistory,
  getStoredDomainHistory,
} from "@/serverFunctions/domain";

type Input = {
  projectId: string;
  domain: string;
  locationCode: number | undefined;
  /** False until the view that shows the result is open. */
  enabled?: boolean;
  /** True once a person has asked for the analysis; until then only stored data. */
  live: boolean;
};

// The history call costs several times the live overview, so it stays fresh
// for as long as the server keeps it cached and never refetches on focus.
export function useDomainHistoryQuery(input: Input) {
  const trimmedDomain = input.domain.trim();
  const enabled = trimmedDomain !== "" && input.enabled !== false;
  const data = {
    projectId: input.projectId,
    domain: trimmedDomain,
    locationCode: input.locationCode,
  };

  const stored = useQuery({
    enabled: enabled && !input.live,
    queryKey: [
      "domain-history-stored",
      input.projectId,
      trimmedDomain,
      input.locationCode,
    ],
    queryFn: () => getStoredDomainHistory({ data }),
    select: (value) => value ?? undefined,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const live = useQuery({
    enabled: enabled && input.live,
    queryKey: [
      "domain-history",
      input.projectId,
      trimmedDomain,
      input.locationCode,
    ],
    queryFn: () => getDomainHistory({ data }),
    staleTime: 12 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) =>
      failureCount < 2 && getErrorCode(error) !== "TRIAL_ENDED",
  });
  return input.live ? live : stored;
}
