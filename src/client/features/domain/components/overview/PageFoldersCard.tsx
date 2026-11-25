import { QueryError } from "@/client/components/QueryState";
import { HelpLabel } from "@/client/components/HelpLabel";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  DATAFORSEO_ESTIMATE,
  SourceNote,
} from "@/client/features/domain/components/overview/SourceNote";
import type { useDomainPagesSummaryQuery } from "@/client/features/domain/hooks/useDomainSampleQueries";
import { formatNumber, formatRounded } from "@/client/features/domain/utils";

type SummaryQuery = ReturnType<typeof useDomainPagesSummaryQuery>;

/** Top pages grouped by their first URL folder, over the highest-traffic pages. */
export function PageFoldersCard({ query }: { query: SummaryQuery }) {
  if (query.isLoading) {
    return (
      <Card className="gap-3 p-4" aria-busy>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }
  if (query.isError) {
    return (
      <QueryError
        variant="card"
        error={query.error}
        fallback="Page folders failed to load."
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const summary = query.data;
  if (!summary || summary.sampleSize === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        The provider returned no ranking pages to group.
      </Card>
    );
  }
  const totalTraffic = summary.folders.reduce(
    (sum, row) => sum + row.traffic,
    0,
  );

  return (
    <Card className="gap-4 p-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          <HelpLabel
            label="Pages by folder"
            helpText="Grouped by the first folder of each page's URL. Root-level pages sit directly under the domain, such as /pricing. The folder says where a page lives, not what kind of page it is."
          />
        </h2>
        <p className="text-xs text-muted-foreground">
          Top {formatNumber(summary.sampleSize)} pages by estimated traffic
          {summary.totalListed != null
            ? ` of ${formatNumber(summary.totalListed)} the provider lists`
            : ""}
          . Not a total for the whole domain.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-normal">Folder</th>
            <th className="py-1 text-right font-normal">Pages</th>
            <th className="py-1 text-right font-normal">Est. traffic</th>
            <th className="w-24 py-1 pl-3 font-normal" />
          </tr>
        </thead>
        <tbody>
          {summary.folders.map((row) => (
            <tr key={row.folder} className="border-t border-border">
              <td className="py-1.5 break-all">{row.folder}</td>
              <td className="py-1.5 text-right tabular-nums">
                {formatNumber(row.pages)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {formatRounded(row.traffic)}
              </td>
              <td className="py-1.5 pl-3">
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-amber-400"
                    style={{
                      width: `${totalTraffic > 0 ? Math.max((row.traffic / totalTraffic) * 100, 2) : 0}%`,
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <SourceNote source={DATAFORSEO_ESTIMATE} date={summary.fetchedAt} />
    </Card>
  );
}
