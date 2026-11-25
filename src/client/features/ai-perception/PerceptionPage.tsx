import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/client/components/PageHeader";
import {
  AiLoading,
  AiQueryError,
} from "@/client/features/ai-visibility/shared";
import { InsightsFiltersBar } from "@/client/features/ai-visibility/insights/InsightsFiltersBar";
import {
  DEFAULT_INSIGHTS_FILTERS,
  insightsQueryOptions,
  type InsightsFilters,
} from "@/client/features/ai-visibility/insights/insightsShared";
import { PerceptionBrands } from "./PerceptionBrands";
import { PerceptionHeatmap } from "./PerceptionHeatmap";
import { PerceptionExperiments } from "./PerceptionExperiments";
import { PerceptionOpportunities } from "./PerceptionOpportunities";
import { PerceptionPopulationLine } from "./PerceptionPopulationLine";
import { PerceptionSources } from "./PerceptionSources";
import { PerceptionThemes } from "./PerceptionThemes";
import { ReadAnswersBar } from "./ReadAnswersBar";
import {
  perceptionOpportunitiesQueryOptions,
  perceptionSourcesQueryOptions,
  perceptionViewQueryOptions,
} from "./perceptionShared";

const SECTIONS = [
  { value: "overview", label: "Overview" },
  { value: "sources", label: "Sources" },
  { value: "concerns", label: "Concerns" },
  { value: "opportunities", label: "Opportunities" },
  { value: "experiments", label: "Experiments" },
] as const;

/**
 * Perception reads the same saved answers and filters as Visibility, so the
 * two pages always describe the same population.
 */
export function PerceptionPage({ projectId }: { projectId: string }) {
  const [filters, setFilters] = useState<InsightsFilters>(
    DEFAULT_INSIGHTS_FILTERS,
  );
  const insights = useQuery({
    ...insightsQueryOptions(projectId, filters),
    placeholderData: keepPreviousData,
  });
  const query = useQuery({
    ...perceptionViewQueryOptions(projectId, filters),
    placeholderData: keepPreviousData,
  });
  const [section, setSection] =
    useState<(typeof SECTIONS)[number]["value"]>("overview");
  const sources = useQuery({
    ...perceptionSourcesQueryOptions(projectId, filters),
    enabled: section === "sources" || section === "concerns",
    placeholderData: keepPreviousData,
  });
  const opportunities = useQuery({
    ...perceptionOpportunitiesQueryOptions(projectId, filters),
    enabled: section === "opportunities",
    placeholderData: keepPreviousData,
  });
  const view = query.data;
  const own = view?.brands.find((brand) => brand.own);
  const update = (patch: Partial<InsightsFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Brand perception"
        description="What AI answers say about you and the brands you track: whether they recommend, describe or discourage, and the answers behind every count."
      />
      <InsightsFiltersBar
        data={insights.data}
        filters={filters}
        onChange={update}
      />
      {query.isPending ? (
        <AiLoading />
      ) : query.isError ? (
        <AiQueryError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : view ? (
        <div
          className={`space-y-5 ${query.isPlaceholderData ? "opacity-60" : ""}`}
          aria-busy={query.isPlaceholderData}
        >
          <PerceptionPopulationLine view={view} />
          <div
            className="flex flex-wrap gap-1"
            role="tablist"
            aria-label="Perception view"
          >
            {SECTIONS.map((x) => (
              <button
                key={x.value}
                type="button"
                role="tab"
                aria-selected={section === x.value}
                onClick={() => setSection(x.value)}
                className={`rounded-md border px-3 py-1.5 text-sm ${section === x.value ? "bg-muted font-medium" : "text-muted-foreground"}`}
              >
                {x.label}
              </button>
            ))}
          </div>
          {section === "overview" ? (
            <>
              {own ? (
                <dl
                  className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  aria-label="Your brand in these answers"
                >
                  <div className="flex gap-1.5">
                    <dd className="order-first font-semibold tabular-nums">
                      {own.recommendedOfMentions.numerator}
                    </dd>
                    <dt>recommended</dt>
                  </div>
                  <div className="flex gap-1.5">
                    <dd className="order-first font-semibold tabular-nums">
                      {own.discouragedOfMentions.numerator}
                    </dd>
                    <dt>discouraged</dt>
                  </div>
                  <div className="flex gap-1.5">
                    <dd className="order-first font-semibold tabular-nums">
                      {own.unread}
                    </dd>
                    <dt>unread</dt>
                  </div>
                  <div className="flex gap-1.5 text-muted-foreground">
                    <dt>Mentions read</dt>
                    <dd className="font-medium tabular-nums">{own.read}</dd>
                  </div>
                </dl>
              ) : null}
              <PerceptionHeatmap
                projectId={projectId}
                filters={filters}
                view={view}
              />
              <ReadAnswersBar projectId={projectId} view={view} />
              <PerceptionBrands
                view={view}
                projectId={projectId}
                filters={{
                  ...filters,
                  promptSetVersionId: view.population.promptSetVersionId,
                }}
                disabled={query.isPlaceholderData}
              />
            </>
          ) : section === "sources" ? (
            <PerceptionSources
              projectId={projectId}
              filters={filters}
              query={sources}
            />
          ) : section === "concerns" ? (
            <PerceptionThemes projectId={projectId} query={sources} />
          ) : section === "experiments" ? (
            <PerceptionExperiments projectId={projectId} />
          ) : (
            <PerceptionOpportunities
              projectId={projectId}
              filters={filters}
              query={opportunities}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
