import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import { HelpLabel } from "@/client/components/HelpLabel";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { gapKeys } from "@/client/features/site-explorer/gap";
import { formatNumber } from "@/client/features/domain/utils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  createOpportunityFromGap,
  getKeywordGap,
} from "@/serverFunctions/site-explorer";

const LIST_SIZE = 10;

/**
 * The project's latest stored keyword gap, for the project's own domain. It
 * reads what the Keyword gap page already stored and never calls the provider;
 * a new run stays a costed action there.
 */
export function StoredGapCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const gap = useQuery({
    queryKey: [...gapKeys.table(projectId), "overview"],
    queryFn: () =>
      getKeywordGap({
        data: {
          projectId,
          query: {
            kind: "missing",
            status: "open",
            page: 1,
            pageSize: LIST_SIZE,
            sortBy: "searchVolume",
            sortDir: "desc",
          },
        },
      }),
    staleTime: 60_000,
  });
  const create = useMutation({
    mutationFn: (input: { runId: string; rowId: string }) =>
      createOpportunityFromGap({ data: { projectId, ...input } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success("Saved to Opportunities");
      void queryClient.invalidateQueries({
        queryKey: gapKeys.table(projectId),
      });
      void queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "That did not work")),
  });

  if (gap.isLoading) {
    return (
      <Card className="gap-3 p-4" aria-busy>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }
  if (gap.isError) {
    return (
      <QueryError
        variant="card"
        error={gap.error}
        fallback="The stored keyword gap failed to load."
        onRetry={() => void gap.refetch()}
        isRetrying={gap.isFetching}
      />
    );
  }

  const data = gap.data;
  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          <HelpLabel
            label="Keyword gap"
            helpText="Keywords your saved competitors rank for that this domain does not, from your latest stored keyword gap run. Reading it costs nothing."
          />
        </h2>
        <Button
          variant="outline"
          size="sm"
          render={
            <Link to="/p/$projectId/keyword-gap" params={{ projectId }} />
          }
        >
          {data ? "Open keyword gap" : "Run a keyword gap"}
        </Button>
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">
          No keyword gap has been run for this project yet. Running one reads
          the provider and shows a cost estimate first.
        </p>
      ) : data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The latest run has no open missing keywords.
        </p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-normal">Keyword</th>
                <th className="py-1 text-right font-normal">Volume</th>
                <th className="py-1 text-left font-normal pl-3">Ranks</th>
                <th className="py-1 font-normal" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-1.5 pr-2 font-medium">{row.keyword}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatNumber(row.searchVolume)}
                  </td>
                  <td className="py-1.5 pl-3 break-all">
                    {row.bestDomain} · {row.bestPosition}
                  </td>
                  <td className="py-1.5 text-right">
                    {row.opportunityId ? (
                      <span className="text-xs text-muted-foreground">
                        In Opportunities
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={create.isPending}
                        onClick={() =>
                          create.mutate({ runId: data.run.id, rowId: row.id })
                        }
                      >
                        Add to Opportunities
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            Top {data.rows.length} of {formatNumber(data.total)} open missing
            keywords by volume, from the run read{" "}
            {formatRelativeTime(data.run.createdAt)} against{" "}
            {data.competitors
              .map((competitor) => competitor.competitorDomain)
              .filter((domain, index, all) => all.indexOf(domain) === index)
              .join(", ")}
            . A sample of each competitor's most-searched keywords, not the
            whole market.
          </p>
        </>
      )}
    </Card>
  );
}
