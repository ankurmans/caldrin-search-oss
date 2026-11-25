import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, GitCompare, Plus, Search } from "lucide-react";
import { useState } from "react";
import { QueryError } from "@/client/components/QueryState";
import { HelpLabel } from "@/client/components/HelpLabel";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { CompetitorCompareSheet } from "@/client/features/domain/components/overview/CompetitorCompareSheet";
import {
  DATAFORSEO_ESTIMATE,
  SourceNote,
} from "@/client/features/domain/components/overview/SourceNote";
import type { useDomainCompetitorsQuery } from "@/client/features/domain/hooks/useDomainCompetitorsQuery";
import { formatNumber, formatRounded } from "@/client/features/domain/utils";
import {
  projectContextQueryKey,
  useContextUpdate,
} from "@/client/features/projects/project-context/shared";
import { getProjectContext } from "@/serverFunctions/projectContext";
import type { ResearchScope } from "@/shared/researchScope";

type CompetitorsQuery = ReturnType<typeof useDomainCompetitorsQuery>;

const bare = (domain: string) => domain.replace(/^www\./i, "").toLowerCase();

/** Organic competitors of the explored domain, with save, explore and compare. */
export function CompetitorsCard({
  projectId,
  scope,
  locationCode,
  query,
}: {
  projectId: string;
  scope: ResearchScope;
  locationCode: number | undefined;
  query: CompetitorsQuery;
}) {
  const [comparing, setComparing] = useState<string | null>(null);
  const context = useQuery({
    queryKey: projectContextQueryKey(projectId),
    queryFn: () => getProjectContext({ data: { projectId } }),
    staleTime: 60_000,
  });
  const update = useContextUpdate(projectId);

  if (query.isLoading) {
    return (
      <Card className="gap-3 p-4" aria-busy>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-48 w-full" />
      </Card>
    );
  }
  if (query.isError) {
    return (
      <QueryError
        variant="card"
        error={query.error}
        fallback="Competitors failed to load."
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const data = query.data;
  if (!data || data.items.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        The provider found no organic competitors for this domain in this
        market.
      </Card>
    );
  }

  const saved = new Set(
    (context.data?.competitors ?? []).map((competitor) =>
      bare(competitor.domain),
    ),
  );
  const maxShared = Math.max(
    ...data.items.map((i) => i.sharedKeywords ?? 0),
    1,
  );

  return (
    <Card className="gap-4 p-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          <HelpLabel
            label="Organic competitors"
            helpText="Domains that rank in Google for the same keywords as this one, most shared keywords first. It says who competes for the same searches, not who sells the same thing. The provider leaves out large global sites such as YouTube and Wikipedia."
          />
        </h2>
        <p className="text-xs text-muted-foreground">
          Top {data.items.length}
          {data.totalCount != null
            ? ` of ${formatNumber(data.totalCount)} the provider counted`
            : ""}
          {data.source === "stored"
            ? ", from this project's saved competitor discovery"
            : ""}
          . Organic keywords and traffic are the provider's estimates.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Competitor</th>
              <th className="py-1 text-right font-normal">Shared keywords</th>
              <th className="w-24 py-1 pl-3 font-normal" />
              <th className="py-1 text-right font-normal">Avg position</th>
              <th className="py-1 text-right font-normal">Organic keywords</th>
              <th className="py-1 text-right font-normal">Est. traffic</th>
              <th className="py-1 font-normal" />
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => {
              const isSaved = saved.has(bare(row.domain));
              return (
                <tr key={row.domain} className="border-t border-border">
                  <td className="py-1.5 pr-2 font-medium break-all">
                    {row.domain}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatNumber(row.sharedKeywords)}
                  </td>
                  <td className="py-1.5 pl-3">
                    <div className="h-2 w-full rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-amber-400"
                        style={{
                          width: `${((row.sharedKeywords ?? 0) / maxShared) * 100}%`,
                        }}
                      />
                    </div>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {row.avgPosition == null ? "-" : row.avgPosition.toFixed(1)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatNumber(row.organicKeywords)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatRounded(row.organicTraffic)}
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setComparing(row.domain)}
                      >
                        <GitCompare /> Compare
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        render={
                          <Link
                            to="/p/$projectId/domain"
                            params={{ projectId }}
                            search={{ domain: row.domain, loc: locationCode }}
                          />
                        }
                      >
                        <Search /> Explore
                      </Button>
                      {isSaved ? (
                        <Button variant="ghost" size="sm" disabled>
                          <Check /> Saved
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={
                            context.data === undefined || update.isPending
                          }
                          onClick={() =>
                            update.mutate([
                              { addCompetitors: [{ domain: row.domain }] },
                            ])
                          }
                        >
                          <Plus /> Save
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        These are Google organic competitors. Whether any of them appears in AI
        answers is measured separately, only for the prompts you track, in{" "}
        <Link
          to="/p/$projectId/ai-visibility"
          params={{ projectId }}
          className="underline underline-offset-2"
        >
          Brand in AI answers
        </Link>
        .
      </p>
      <SourceNote
        source={
          data.source === "stored"
            ? `${DATAFORSEO_ESTIMATE} · saved competitor discovery`
            : DATAFORSEO_ESTIMATE
        }
        date={data.fetchedAt}
      />

      <CompetitorCompareSheet
        projectId={projectId}
        domain={data.domain}
        scope={scope}
        locationCode={locationCode}
        competitor={comparing}
        costUsd={data.headToHeadUsd}
        onClose={() => setComparing(null)}
      />
    </Card>
  );
}
