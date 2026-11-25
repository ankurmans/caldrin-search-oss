import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import { contentKey } from "@/client/features/content/helpers";
import { getContentOverview } from "@/serverFunctions/content";
import { getDashboardActivation } from "@/serverFunctions/dashboard";
import {
  getSearchOpportunities,
  runSearchOpportunityEngine,
} from "@/serverFunctions/opportunities";
import { NoMatches, NoOpportunities } from "./OpportunitiesEmpty";
import { useStorePlatform } from "@/client/features/content/ShopifyPlatformGate";
import { OpportunityDetailSheet } from "./OpportunityDetailSheet";
import {
  ALL,
  NO_FILTERS,
  OpportunityFilters,
  type Filters,
} from "./OpportunityFilters";
import { OpportunityRow } from "./OpportunityRow";
import { PaidKeywordGapPanel } from "./PaidKeywordGapPanel";
import { RunSummary, type RunSummaryData } from "./RunSummary";
import { opportunitiesKey, unwrap } from "./helpers";
import { useOpportunityActions } from "./useOpportunityActions";

function toQueryFilters(filters: Filters) {
  return {
    intent: filters.intent === ALL ? undefined : filters.intent,
    action: filters.action === ALL ? undefined : filters.action,
    status: filters.status === ALL ? undefined : filters.status,
    source: filters.source === ALL ? undefined : filters.source,
  };
}

export function OpportunitiesPage({
  projectId,
  initialOpenId,
}: {
  projectId: string;
  initialOpenId?: string;
}) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [drafted, setDrafted] = useState<ReadonlySet<string>>(new Set());
  const [summary, setSummary] = useState<RunSummaryData | null>(null);

  const queryFilters = toQueryFilters(filters);
  const query = useQuery({
    queryKey: [...opportunitiesKey(projectId), "list", queryFilters],
    queryFn: () =>
      getSearchOpportunities({ data: { projectId, ...queryFilters } }),
  });
  // Which sources are connected decides what an empty list should say.
  const activation = useQuery({
    queryKey: ["dashboardActivation", projectId],
    queryFn: () => getDashboardActivation({ data: { projectId } }),
  });
  const store = useQuery({
    queryKey: contentKey(projectId),
    queryFn: () => getContentOverview({ data: { projectId } }),
  });
  const platform = useStorePlatform(projectId);
  const readiness =
    activation.data && store.data && platform.data
      ? {
          gscConnected: activation.data.gsc.connected,
          storeMode: store.data.connection?.mode ?? null,
          storeRelevant: platform.data.visible,
        }
      : undefined;
  const actions = useOpportunityActions(projectId, (id) =>
    setDrafted((previous) => new Set(previous).add(id)),
  );
  const run = useMutation({
    mutationFn: (paid: { allowPaid: boolean; repeatPaid?: boolean }) =>
      runSearchOpportunityEngine({ data: { projectId, ...paid } }),
    onSuccess: (result) => {
      const data = unwrap(result);
      if (data) setSummary(data);
      // A refusal can mean the state moved on (e.g. a paid run already
      // happened elsewhere today), so the estimate is read again either way.
      void queryClient.invalidateQueries({
        queryKey: opportunitiesKey(projectId),
      });
    },
  });

  const filtered = Object.values(filters).some((value) => value !== ALL);
  const opened =
    query.data?.find((opportunity) => opportunity.id === openId) ?? null;
  const runButton = (
    <Button
      size="sm"
      disabled={run.isPending}
      onClick={() => run.mutate({ allowPaid: false })}
    >
      {run.isPending ? "Analyzing…" : "Run analysis"}
    </Button>
  );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="Opportunities"
        description="Ranked recommendations from your search data, each with the evidence behind it. Nothing is changed on your site from here."
        actions={runButton}
      />
      {summary ? (
        <RunSummary summary={summary} onDismiss={() => setSummary(null)} />
      ) : null}
      <PaidKeywordGapPanel
        projectId={projectId}
        running={run.isPending}
        onConfirm={(repeat) =>
          run.mutate({ allowPaid: true, repeatPaid: repeat })
        }
      />
      <OpportunityFilters value={filters} onChange={setFilters} />
      <QueryState
        query={query}
        loading={<SkeletonCard />}
        errorFallback="Could not load opportunities."
      >
        {(rows) =>
          rows.length === 0 ? (
            filtered ? (
              <NoMatches onClear={() => setFilters(NO_FILTERS)} />
            ) : (
              <NoOpportunities
                projectId={projectId}
                readiness={readiness}
                ranNothing={summary?.stored === 0}
                onRun={() => run.mutate({ allowPaid: false })}
                running={run.isPending}
              />
            )
          ) : (
            <ul className="grid items-start gap-3 xl:grid-cols-2">
              {rows.map((opportunity) => (
                <OpportunityRow
                  key={opportunity.id}
                  opportunity={opportunity}
                  onOpen={() => setOpenId(opportunity.id)}
                />
              ))}
            </ul>
          )
        }
      </QueryState>
      <OpportunityDetailSheet
        projectId={projectId}
        opportunity={opened}
        actions={actions}
        drafted={openId !== null && drafted.has(openId)}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
