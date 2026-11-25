import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/client/components/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { EngineFilter } from "../ai-visibility/EngineFilter";
import { AiLoading, AiQueryError } from "../ai-visibility/shared";
import { SourceGapTopics } from "../source-gap/SourceGapTopics";
import { CitationSources } from "./CitationSources";
import { GapFindingCard } from "./GapFindingCard";
import {
  citationGapsQueryOptions,
  DEFAULT_CITATION_GAP_FILTERS,
  type CitationGapFilters,
} from "./citationGapsShared";

const PERIODS = [
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "28", label: "Last 28 days", days: 28 },
  { value: "90", label: "Last 90 days", days: 90 },
] as const;
const ALL = "__all";

/**
 * Where competitors appear in AI answers, which sites those answers cite, and
 * the gaps worth acting on, all read from stored answers of the newest prompt
 * set. Nothing here collects new answers.
 */
export function CitationGapsPage({ projectId }: { projectId: string }) {
  const [filters, setFilters] = useState<CitationGapFilters>(
    DEFAULT_CITATION_GAP_FILTERS,
  );
  const query = useQuery({
    ...citationGapsQueryOptions(projectId, filters),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const topics = data?.options.topics ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Citation Gaps"
        description="Where competitors show up in AI answers without you, which sites those answers cite, and what you could do about it. Every finding links to the answers behind it."
      />
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filters"
      >
        <Select
          items={PERIODS}
          value={String(filters.days)}
          onValueChange={(v) => {
            const period = PERIODS.find((p) => p.value === v);
            if (period) setFilters({ ...filters, days: period.days });
          }}
        >
          <SelectTrigger
            aria-label="Measurement period"
            className="h-10 min-w-36"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-max min-w-(--anchor-width) max-w-[min(24rem,var(--available-width))]">
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data && data.options.engines.length > 1 ? (
          <EngineFilter
            label="Filter by engine"
            engines={data.options.engines}
            value={filters.engines ?? data.options.engines}
            onChange={(next) =>
              setFilters({
                ...filters,
                engines:
                  next.length === data.options.engines.length ? null : next,
              })
            }
          />
        ) : null}
        {topics.length > 1 ? (
          <Select
            items={[
              { value: ALL, label: "All prompt groups" },
              ...topics.map((t) => ({ value: t, label: t })),
            ]}
            value={filters.topic ?? ALL}
            onValueChange={(v) => {
              if (typeof v === "string")
                setFilters({ ...filters, topic: v === ALL ? null : v });
            }}
          >
            <SelectTrigger aria-label="Prompt group" className="h-10 min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-max min-w-(--anchor-width) max-w-[min(24rem,var(--available-width))]">
              <SelectItem value={ALL}>All prompt groups</SelectItem>
              {topics.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {query.isPending ? (
        <AiLoading />
      ) : query.isError ? (
        <AiQueryError error={query.error} retry={() => void query.refetch()} />
      ) : data ? (
        <div
          className={`space-y-5 ${query.isPlaceholderData ? "opacity-60" : ""}`}
        >
          <section
            className="space-y-1 text-sm text-muted-foreground"
            aria-label="What this is based on"
          >
            <p>
              Based on {data.coverage.answered} answered collections (
              {data.coverage.planned} planned) across {data.coverage.prompts}{" "}
              prompts, {data.coverage.runs} run(s) and{" "}
              {data.coverage.engines.length} engine(s),{" "}
              {new Date(data.window.start).toLocaleDateString()} to{" "}
              {new Date(data.window.end).toLocaleDateString()}.
            </p>
            {data.notes.map((note) => (
              <p key={note} className="text-xs">
                {note}
              </p>
            ))}
          </section>
          <section className="space-y-3" aria-label="Findings">
            <h2 className="text-sm font-medium">
              Findings ({data.findings.length})
            </h2>
            {data.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No gaps in this selection: no answers name or cite a competitor
                without you.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.findings.map((finding) => (
                  <GapFindingCard
                    key={finding.key}
                    projectId={projectId}
                    filters={filters}
                    finding={finding}
                  />
                ))}
              </ul>
            )}
          </section>
          <SourceGapTopics projectId={projectId} />
          <CitationSources
            projectId={projectId}
            filters={filters}
            sources={data.sources}
            answered={data.coverage.answered}
          />
        </div>
      ) : null}
    </div>
  );
}
