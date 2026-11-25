import { useState } from "react";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { Skeleton } from "@/client/components/ui/skeleton";
import { ExternalUrlCell } from "@/client/components/table/url";
import { intentLabel } from "@/client/features/domain/components/KeywordIntentBadge";
import {
  DATAFORSEO_ESTIMATE,
  SourceNote,
} from "@/client/features/domain/components/overview/SourceNote";
import { useDomainHeadToHeadQuery } from "@/client/features/domain/hooks/useDomainCompetitorsQuery";
import { formatNumber } from "@/client/features/domain/utils";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import type { ResearchScope } from "@/shared/researchScope";

type Kind = "gap" | "shared";

const KINDS: { kind: Kind; label: string; help: string }[] = [
  {
    kind: "gap",
    label: "They rank, you don't",
    help: "Keywords the competitor ranks for that the provider has no ranking for on this domain.",
  },
  {
    kind: "shared",
    label: "Both rank",
    help: "Keywords where both domains rank, with each side's position.",
  },
];

function pathOf(url: string) {
  try {
    const { pathname, search } = new URL(url);
    return `${pathname}${search}`;
  } catch {
    return url;
  }
}

/** Most-searched keywords between the domain and one competitor, read on click. */
export function CompetitorCompareSheet({
  projectId,
  domain,
  scope,
  locationCode,
  competitor,
  costUsd,
  onClose,
}: {
  projectId: string;
  domain: string;
  scope: ResearchScope;
  locationCode: number | undefined;
  competitor: string | null;
  costUsd: number;
  onClose: () => void;
}) {
  const { cost } = useCostDisplay();
  const price = cost(costUsd);
  // A new competitor starts with nothing loaded, so opening the panel never
  // spends: each read waits for its own button.
  const [chosen, setChosen] = useState<{
    competitor: string;
    kind: Kind;
  } | null>(null);
  const kind = chosen?.competitor === competitor ? chosen.kind : null;
  const query = useDomainHeadToHeadQuery({
    projectId,
    domain,
    scope,
    locationCode,
    competitor,
    kind,
  });

  return (
    <Sheet
      open={competitor !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="break-all">{competitor}</SheetTitle>
          <SheetDescription>
            Compared with {domain}.{" "}
            {price
              ? `Each list is one provider read, about ${price}, and is kept for 12 hours.`
              : "Each list is a paid lookup included in your plan and is kept for 12 hours."}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="flex flex-wrap gap-2">
            {KINDS.map((option) => (
              <Button
                key={option.kind}
                variant={kind === option.kind ? "default" : "outline"}
                size="sm"
                title={option.help}
                onClick={() =>
                  competitor && setChosen({ competitor, kind: option.kind })
                }
              >
                {option.label}
                {kind === option.kind || !price ? "" : ` · ${price}`}
              </Button>
            ))}
          </div>

          {kind === null ? (
            <p className="text-sm text-muted-foreground">
              Choose a list to read it. Nothing is fetched until you do.
            </p>
          ) : query.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : query.isError ? (
            <QueryError
              error={query.error}
              fallback="The comparison failed to load."
              onRetry={() => void query.refetch()}
              isRetrying={query.isFetching}
            />
          ) : query.data && query.data.keywords.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 text-left font-normal">Keyword</th>
                      <th className="px-2 py-1 text-right font-normal">
                        Volume
                      </th>
                      <th className="px-2 py-1 text-right font-normal">KD</th>
                      <th className="py-1 text-left font-normal pl-3">
                        Intent
                      </th>
                      <th className="px-2 py-1 text-right font-normal">Them</th>
                      <th className="px-2 py-1 text-right font-normal">You</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.keywords.map((row) => (
                      <tr key={row.keyword} className="border-t border-border">
                        <td className="py-1.5 pr-2">
                          <div className="font-medium">{row.keyword}</div>
                          {row.competitorUrl ? (
                            <div className="max-w-56 truncate text-xs">
                              <ExternalUrlCell
                                value={row.competitorUrl}
                                label={pathOf(row.competitorUrl)}
                                baseDomain={query.data.competitor}
                              />
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatNumber(row.searchVolume)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {row.keywordDifficulty ?? "-"}
                        </td>
                        <td className="py-1.5 pl-3">
                          {intentLabel(row.intent)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {row.competitorPosition ?? "-"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {row.domainPosition ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Top {query.data.keywords.length} by search volume
                {query.data.totalCount != null
                  ? ` of ${formatNumber(query.data.totalCount)} the provider counted`
                  : ""}
                . A sample, not every keyword.
              </p>
              <SourceNote
                source={DATAFORSEO_ESTIMATE}
                date={query.data.fetchedAt}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              The provider returned no keywords for this comparison.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
