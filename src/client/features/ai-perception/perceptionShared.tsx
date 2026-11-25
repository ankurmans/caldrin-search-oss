import { queryOptions } from "@tanstack/react-query";
import {
  getAiPerceptionCell,
  getAiPerceptionExperiment,
  listAiPerceptionExperiments,
  getAiPerceptionOpportunities,
  getAiPerceptionSourceEvidence,
  getAiPerceptionSources,
  getAiPerceptionView,
} from "@/serverFunctions/ai-perception";
import {
  PERCEPTION_OUTCOMES,
  PERCEPTION_OUTCOME_LABELS,
  type PerceptionOutcome,
} from "@/shared/ai-perception";
import { aiVisibilityKey } from "@/client/features/ai-visibility/shared";
import type { InsightsFilters } from "@/client/features/ai-visibility/insights/insightsShared";

const OUTCOME_COLOR: Record<PerceptionOutcome, string> = {
  recommended: "bg-emerald-500 dark:bg-emerald-400",
  neutral: "bg-slate-400 dark:bg-slate-500",
  negative: "bg-rose-500 dark:bg-rose-400",
  unread:
    "bg-amber-300 bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(0,0,0,0.12)_4px_8px)] dark:bg-amber-500/70",
  missing: "bg-muted",
};

export const OUTCOME_TEXT: Record<PerceptionOutcome, string> = {
  recommended: "text-emerald-700 dark:text-emerald-300",
  neutral: "text-slate-600 dark:text-slate-300",
  negative: "text-rose-700 dark:text-rose-300",
  unread: "text-amber-700 dark:text-amber-300",
  missing: "text-muted-foreground",
};

export const perceptionViewQueryOptions = (
  projectId: string,
  filters: InsightsFilters,
) =>
  queryOptions({
    queryKey: [...aiVisibilityKey(projectId), "perception", filters],
    queryFn: () => getAiPerceptionView({ data: { projectId, ...filters } }),
  });

export const perceptionCellQueryOptions = (
  projectId: string,
  filters: InsightsFilters,
  cell: { domain: string; promptId?: string; topic?: string },
) =>
  queryOptions({
    queryKey: [...aiVisibilityKey(projectId), "perceptionCell", filters, cell],
    queryFn: () =>
      getAiPerceptionCell({ data: { projectId, ...filters, ...cell } }),
    staleTime: 0,
  });

export const perceptionSourcesQueryOptions = (
  projectId: string,
  filters: InsightsFilters,
) =>
  queryOptions({
    queryKey: [...aiVisibilityKey(projectId), "perceptionSources", filters],
    queryFn: () => getAiPerceptionSources({ data: { projectId, ...filters } }),
  });

export const perceptionSourceEvidenceQueryOptions = (
  projectId: string,
  filters: InsightsFilters,
  target: { domain: string; sourceDomain: string },
) =>
  queryOptions({
    queryKey: [
      ...aiVisibilityKey(projectId),
      "perceptionSourceEvidence",
      filters,
      target,
    ],
    queryFn: () =>
      getAiPerceptionSourceEvidence({
        data: { projectId, ...filters, ...target },
      }),
    staleTime: 0,
  });

export const perceptionOpportunitiesQueryOptions = (
  projectId: string,
  filters: InsightsFilters,
) =>
  queryOptions({
    queryKey: [
      ...aiVisibilityKey(projectId),
      "perceptionOpportunities",
      filters,
    ],
    queryFn: () =>
      getAiPerceptionOpportunities({ data: { projectId, ...filters } }),
  });

export const perceptionExperimentsQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: [...aiVisibilityKey(projectId), "perceptionExperiments"],
    queryFn: () => listAiPerceptionExperiments({ data: { projectId } }),
  });

export const perceptionExperimentQueryOptions = (
  projectId: string,
  experimentId: string,
) =>
  queryOptions({
    queryKey: [
      ...aiVisibilityKey(projectId),
      "perceptionExperiments",
      experimentId,
    ],
    queryFn: () =>
      getAiPerceptionExperiment({ data: { projectId, experimentId } }),
    staleTime: 0,
  });

/** The share of a bar each outcome takes, with the counts a person can read. */
export function OutcomeBar({
  counts,
  className = "h-2.5",
  outcomes = PERCEPTION_OUTCOMES,
}: {
  counts: Record<PerceptionOutcome, number>;
  className?: string;
  outcomes?: readonly PerceptionOutcome[];
}) {
  const total = outcomes.reduce((sum, o) => sum + counts[o], 0);
  const label = outcomes
    .filter((o) => counts[o])
    .map((o) => `${counts[o]} ${PERCEPTION_OUTCOME_LABELS[o].toLowerCase()}`)
    .join(", ");
  return (
    <div
      className={`flex w-full overflow-hidden rounded-full bg-muted ${className}`}
      role="img"
      aria-label={label || "No answers"}
    >
      {total
        ? outcomes.map((o) =>
            counts[o] ? (
              <div
                key={o}
                className={OUTCOME_COLOR[o]}
                style={{ width: `${(counts[o] / total) * 100}%` }}
              />
            ) : null,
          )
        : null}
    </div>
  );
}

export function OutcomeLegend({
  outcomes = PERCEPTION_OUTCOMES,
}: {
  outcomes?: readonly PerceptionOutcome[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {outcomes.map((o) => (
        <li key={o} className="flex items-center gap-1.5">
          <span
            className={`inline-block size-2.5 rounded-sm ${OUTCOME_COLOR[o]}`}
          />
          {PERCEPTION_OUTCOME_LABELS[o]}
        </li>
      ))}
    </ul>
  );
}
