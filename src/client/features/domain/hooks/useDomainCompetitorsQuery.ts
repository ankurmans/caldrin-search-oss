import { useQuery } from "@tanstack/react-query";
import { getErrorCode } from "@/client/lib/error-messages";
import {
  getDomainCompetitors,
  getDomainHeadToHead,
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

const retry = (failureCount: number, error: unknown) =>
  failureCount < 2 && getErrorCode(error) !== "TRIAL_ENDED";

// One list read the server caches for 12 hours, so focus never refetches it.
export function useDomainCompetitorsQuery(input: Input) {
  const domain = input.domain.trim();
  return useQuery({
    enabled: domain !== "" && input.enabled !== false,
    queryKey: [
      "domain-competitors",
      input.projectId,
      domain,
      input.locationCode,
    ],
    queryFn: () =>
      getDomainCompetitors({
        data: {
          projectId: input.projectId,
          domain,
          scope: input.scope,
          locationCode: input.locationCode,
        },
      }),
    staleTime: 12 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry,
  });
}

// Paid, so it stays off until `kind` is chosen by a click.
export function useDomainHeadToHeadQuery(
  input: Input & {
    competitor: string | null;
    kind: "gap" | "shared" | null;
  },
) {
  const domain = input.domain.trim();
  const { competitor, kind } = input;
  return useQuery({
    enabled: domain !== "" && competitor !== null && kind !== null,
    queryKey: [
      "domain-head-to-head",
      input.projectId,
      domain,
      competitor,
      kind,
      input.locationCode,
    ],
    queryFn: () =>
      getDomainHeadToHead({
        data: {
          projectId: input.projectId,
          domain,
          competitor: competitor ?? "",
          kind: kind ?? "gap",
          scope: input.scope,
          locationCode: input.locationCode,
        },
      }),
    staleTime: 12 * 60 * 60_000,
    refetchOnWindowFocus: false,
    retry,
  });
}
