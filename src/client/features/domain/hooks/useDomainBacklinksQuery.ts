import { useQuery } from "@tanstack/react-query";
import {
  getBacklinksOverview,
  getStoredBacklinksOverview,
} from "@/serverFunctions/backlinks";
import type { ResearchScope } from "@/shared/researchScope";

type Input = {
  projectId: string;
  domain: string;
  scope: ResearchScope;
  /** True once a person has asked for the analysis; until then only stored data. */
  live: boolean;
};

/**
 * The backlink summary behind Domain Rank and the Backlinks view. The live key
 * matches the Backlinks page, so the two share one cached read.
 */
export function useDomainBacklinksQuery(input: Input) {
  const enabled = input.domain.trim() !== "";
  const data = {
    projectId: input.projectId,
    target: input.domain,
    scope: input.scope,
  };

  const stored = useQuery({
    enabled: enabled && !input.live,
    queryKey: [
      "backlinksOverview-stored",
      input.projectId,
      input.scope,
      input.domain,
    ],
    queryFn: () => getStoredBacklinksOverview({ data }),
    select: (value) => value ?? undefined,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const live = useQuery({
    enabled: enabled && input.live,
    queryKey: ["backlinksOverview", input.projectId, input.scope, input.domain],
    queryFn: () => getBacklinksOverview({ data }),
    staleTime: 5 * 60_000,
  });
  return input.live ? live : stored;
}
