import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { PageHeader } from "@/client/components/PageHeader";
import { AiLoading, AiQueryError } from "../shared";
import { InsightsEngineGrid } from "./InsightsEngineGrid";
import { InsightsEvidence } from "./InsightsEvidence";
import { InsightsFiltersBar } from "./InsightsFiltersBar";
import { InsightsNextSteps } from "./InsightsNextSteps";
import { InsightsLeaderboard } from "./InsightsLeaderboard";
import { InsightsScorecard } from "./InsightsScorecard";
import { InsightsTrend } from "./InsightsTrend";
import {
  DEFAULT_INSIGHTS_FILTERS,
  insightsQueryOptions,
  type InsightsFilters,
} from "./insightsShared";

/**
 * Scorecard, trend and leaderboard come from one read; the evidence list pages
 * through the same runs and filters, so every filter changes the numbers,
 * their denominators and the evidence together.
 */
export function InsightsPage({ projectId }: { projectId: string }) {
  const [filters, setFilters] = useState<InsightsFilters>(
    DEFAULT_INSIGHTS_FILTERS,
  );
  const [compareByEngine, setCompareByEngine] = useState(false);
  const query = useQuery({
    ...insightsQueryOptions(projectId, filters),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const update = (patch: Partial<InsightsFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Visibility Insights"
        description="How often AI answers name, cite and recommend you and the brands you track, with every number traceable to the answers behind it."
      />
      <InsightsFiltersBar data={data} filters={filters} onChange={update} />
      {query.isPending ? (
        <AiLoading />
      ) : query.isError ? (
        <AiQueryError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : data ? (
        <div
          className={`space-y-5 ${query.isPlaceholderData ? "opacity-60" : ""}`}
          aria-busy={query.isPlaceholderData}
        >
          <InsightsScorecard data={data} projectId={projectId} />
          <InsightsNextSteps projectId={projectId} filters={filters} />
          <InsightsTrend data={data} />
          <div className="space-y-2" inert={query.isPlaceholderData}>
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label="Competitor comparison view"
            >
              <Button
                size="sm"
                variant={compareByEngine ? "ghost" : "secondary"}
                aria-pressed={!compareByEngine}
                onClick={() => setCompareByEngine(false)}
              >
                Leaderboard
              </Button>
              <Button
                size="sm"
                variant={compareByEngine ? "secondary" : "ghost"}
                aria-pressed={compareByEngine}
                onClick={() => setCompareByEngine(true)}
              >
                Compare by engine
              </Button>
            </div>
            {compareByEngine ? (
              <InsightsEngineGrid
                key={JSON.stringify(filters)}
                projectId={projectId}
                data={data}
                filters={filters}
              />
            ) : (
              <InsightsLeaderboard
                projectId={projectId}
                data={data}
                selected={data.evidence.brandDomain}
                onSelect={(brand) => update({ brand })}
              />
            )}
          </div>
          <InsightsEvidence
            projectId={projectId}
            filters={filters}
            data={data}
          />
        </div>
      ) : null}
    </div>
  );
}
