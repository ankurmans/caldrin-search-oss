import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { HelpLabel } from "@/client/components/HelpLabel";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { exportRows } from "@/client/lib/exportRows";
import { getBacklinksAnchors } from "@/serverFunctions/backlinks";
import { backlinksReadUsd } from "@/shared/backlinks-cost";
import type { BacklinksTargetScope } from "@/types/schemas/backlinks";
import { classifyAnchor, type AnchorKind } from "./anchorClassification";
import { formatCompactDate, formatNumber } from "./backlinksPageUtils";

const PAGE_SIZE = 100;
const KIND_LABELS: Record<AnchorKind, string> = {
  branded: "Branded",
  url: "URL",
  generic: "Generic",
  other: "Other",
  empty: "No text",
};

function hostOf(target: string) {
  return target
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();
}

/**
 * The anchor text people link with, as the provider counts it. Reading it is
 * one paid provider read, so it waits for a click that states the cost and
 * then stays cached for the target.
 */
export function BacklinksAnchorsCard({
  projectId,
  target,
  scope,
}: {
  projectId: string;
  target: string;
  scope: BacklinksTargetScope;
}) {
  const [requested, setRequested] = useState(false);
  const { cost } = useCostDisplay();
  const query = useQuery({
    queryKey: ["backlinksAnchors", projectId, scope, target],
    enabled: requested && scope !== "subfolder",
    staleTime: 5 * 60_000,
    queryFn: () =>
      getBacklinksAnchors({
        data: {
          projectId,
          target,
          scope,
          page: 1,
          pageSize: PAGE_SIZE,
          sortField: "backlinks",
          sortOrder: "desc",
          filters: {},
        },
      }),
  });
  const host = hostOf(target);
  const rows = useMemo(
    () =>
      (query.data?.rows ?? []).map((row) => ({
        ...row,
        kind: classifyAnchor(row.anchor, host),
      })),
    [query.data, host],
  );
  const totals = useMemo(() => {
    const out: Record<AnchorKind, number> = {
      branded: 0,
      url: 0,
      generic: 0,
      other: 0,
      empty: 0,
    };
    for (const row of rows) out[row.kind] += row.backlinks ?? 0;
    return out;
  }, [rows]);
  const totalLinks = Object.values(totals).reduce((sum, n) => sum + n, 0);

  if (scope === "subfolder") return null;

  const estimate = cost(backlinksReadUsd(PAGE_SIZE));
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          <HelpLabel
            label="Anchor text"
            helpText="The words linking pages use, with how many links, domains and pages use each. Labels are a rough guess from the text alone and read the domain's first label as the brand."
          />
        </h2>
        {query.data ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void exportRows({
                format: "csv",
                feature: "backlinks_anchors",
                filename: `backlinks-anchors-${host}`,
                headers: [
                  "Anchor",
                  "Label",
                  "Backlinks",
                  "Referring Domains",
                  "Referring Pages",
                  "Nofollow Domains",
                  "Spam Score",
                  "First Seen",
                  "Attributes",
                ],
                rows: rows.map((row) => [
                  row.anchor,
                  KIND_LABELS[row.kind],
                  row.backlinks,
                  row.referringDomains,
                  row.referringPages,
                  row.nofollowDomains,
                  row.spamScore,
                  row.firstSeen,
                  Object.entries(row.attributes)
                    .map(([key, count]) => `${key}: ${count}`)
                    .join(", "),
                ]),
              })
            }
          >
            <Download data-icon="inline-start" />
            Export CSV
          </Button>
        ) : null}
      </div>

      {!requested ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Read the {PAGE_SIZE} most-used anchors for {host}. This is one
            provider read and is saved for six hours.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRequested(true)}
          >
            {estimate ? `Load anchor text, ${estimate}` : "Load anchor text"}
          </Button>
        </div>
      ) : query.isPending ? (
        <Skeleton className="h-32 w-full" aria-busy />
      ) : query.isError ? (
        <QueryError
          variant="card"
          error={query.error}
          fallback="Anchor text failed to load."
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      ) : (
        <>
          <p className="flex flex-wrap gap-2 text-sm">
            {(["branded", "url", "generic", "other"] as const).map((kind) => (
              <Badge key={kind} variant="secondary">
                {KIND_LABELS[kind]}{" "}
                {totalLinks > 0
                  ? `${Math.round((totals[kind] / totalLinks) * 100)}%`
                  : "-"}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground">
              Share of links across these {rows.length} anchors, of{" "}
              {formatNumber(query.data.totalCount)} the provider lists.
            </span>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-normal">Anchor</th>
                  <th className="py-1 pl-3 text-left font-normal">Label</th>
                  <th className="py-1 pl-3 text-right font-normal">Links</th>
                  <th className="py-1 pl-3 text-right font-normal">Domains</th>
                  <th className="py-1 pl-3 text-right font-normal">Pages</th>
                  <th className="py-1 pl-3 text-right font-normal">Spam</th>
                  <th className="py-1 pl-3 text-left font-normal">
                    First seen
                  </th>
                  <th className="py-1 pl-3 text-left font-normal">
                    Attributes
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row, index) => (
                  <tr
                    key={`${row.anchor}:${index}`}
                    className="border-t border-border align-top"
                  >
                    <td className="py-1.5 pr-2 break-words">
                      {row.anchor || (
                        <span className="text-muted-foreground">No text</span>
                      )}
                    </td>
                    <td className="py-1.5 pl-3 whitespace-nowrap">
                      {KIND_LABELS[row.kind]}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {formatNumber(row.backlinks)}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {formatNumber(row.referringDomains)}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {formatNumber(row.referringPages)}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {row.spamScore == null ? "-" : Math.round(row.spamScore)}
                    </td>
                    <td className="py-1.5 pl-3 whitespace-nowrap">
                      {formatCompactDate(row.firstSeen)}
                    </td>
                    <td className="py-1.5 pl-3 text-xs text-muted-foreground">
                      {Object.entries(row.attributes)
                        .map(([key, count]) => `${key} ${count}`)
                        .join(", ") || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 50 ? (
            <p className="text-xs text-muted-foreground">
              Showing the top 50. Export for all {rows.length} read.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
