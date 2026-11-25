import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpLabel } from "@/client/components/HelpLabel";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { SourceNote } from "@/client/features/domain/components/overview/SourceNote";
import { formatNumber } from "@/client/features/domain/utils";
import { getDomainIntersection } from "@/serverFunctions/domainIntersection";
import {
  Evidence,
  organicLabel,
  type Row,
} from "@/client/features/domain/components/ai/IntersectionEvidence";
import type { ResearchScope } from "@/shared/researchScope";

const GAP_LABELS = {
  ranks_not_cited: "Ranks, not cited",
  missing_from_both: "Missing from both",
  cited_without_ranking: "Cited, not ranking",
} as const;

function aiLabel(row: Row) {
  if (row.answers.some((answer) => answer.cited)) return "Cited";
  if (row.answers.some((answer) => answer.named)) return "Named, not cited";
  if (row.answers.length > 0) return "Not named";
  return "No AI answer captured";
}

/**
 * Where Google organic results and AI answers meet for the same query. It
 * reads stored data only. A query with no organic reading says so; reading a
 * live SERP is a separate click that shows its cost first.
 */
export function IntersectionCard({
  projectId,
  domain,
  scope,
  locationCode,
}: {
  projectId: string;
  domain: string;
  scope: ResearchScope;
  locationCode: number | undefined;
}) {
  const queryClient = useQueryClient();
  const input = { projectId, domain, scope, locationCode };
  const queryKey = [
    "domain-intersection",
    projectId,
    domain,
    scope,
    locationCode,
  ];
  const query = useQuery({
    queryKey,
    queryFn: () => getDomainIntersection({ data: input }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(25);

  if (query.isLoading) {
    return (
      <Card className="gap-3 p-4" aria-busy>
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }
  if (query.isError) {
    return (
      <QueryError
        variant="card"
        error={query.error}
        fallback="The organic and AI comparison failed to load."
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const data = query.data;
  if (!data) return null;

  const { counts, sources } = data;
  return (
    <Card className="gap-3 p-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          <HelpLabel
            label="Organic and AI answers"
            helpText="For each question AI engines were observed answering, what Google organic shows for the same query. A pair is only compared when the market matches and both were collected close together. A missing organic reading is not a failure to rank."
          />
        </h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <SourceNote
            source="AI answers: DataForSEO AI mentions"
            date={
              sources.providerMentions.status === "stored"
                ? sources.providerMentions.fetchedAt
                : undefined
            }
          />
          <SourceNote
            source="Organic: stored keyword sample, SERP reads and rank tracker"
            date={
              sources.keywordSample.status === "stored"
                ? sources.keywordSample.fetchedAt
                : undefined
            }
          />
        </div>
      </div>

      {counts.aiQueries === 0 ? (
        <p className="text-sm text-muted-foreground">
          No AI answers are stored for {data.domain} in this market, so there is
          nothing to compare yet. Run the AI mentions lookup first.
        </p>
      ) : (
        <>
          <p className="text-sm">
            {counts.aiQueries} AI questions · {counts.withOrganic} with an
            organic reading · {counts.comparable} comparable ·{" "}
            <span className="text-muted-foreground">
              {counts.withoutOrganic} without an organic reading
            </span>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-normal">Query</th>
                  <th className="py-1 pl-3 text-left font-normal">
                    Google organic
                  </th>
                  <th className="py-1 pl-3 text-left font-normal">
                    AI answers
                  </th>
                  <th className="py-1 pl-3 text-left font-normal">Finding</th>
                  <th className="py-1 font-normal" />
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, shown).map((row) => (
                  <Fragment key={row.key}>
                    <tr className="border-t border-border align-top">
                      <td className="py-1.5 pr-2 break-words">{row.query}</td>
                      <td className="py-1.5 pl-3 whitespace-nowrap">
                        {organicLabel(row)}
                      </td>
                      <td className="py-1.5 pl-3 whitespace-nowrap">
                        {aiLabel(row)}
                      </td>
                      <td className="py-1.5 pl-3">
                        {row.gap ? (
                          <Badge variant="secondary">
                            {GAP_LABELS[row.gap]}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            {row.comparable
                              ? "No gap found"
                              : row.organic
                                ? "Different market or date"
                                : "Google check needed"}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={open === row.key}
                          onClick={() =>
                            setOpen(open === row.key ? null : row.key)
                          }
                        >
                          {open === row.key ? "Hide" : "Evidence"}
                        </Button>
                      </td>
                    </tr>
                    {open === row.key ? (
                      <tr>
                        <td colSpan={5} className="pb-3">
                          <Evidence
                            projectId={projectId}
                            row={row}
                            input={input}
                            queryKey={queryKey}
                            onChanged={() =>
                              void queryClient.invalidateQueries({ queryKey })
                            }
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {data.rows.length > shown ? (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => setShown(shown + 25)}
            >
              Show more
            </Button>
          ) : null}
          {counts.organicWithoutAi > 0 ? (
            <p className="text-xs text-muted-foreground">
              {formatNumber(counts.organicWithoutAi)} ranking keywords in the
              stored sample have no AI answer recorded. That is missing data,
              not a gap.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
