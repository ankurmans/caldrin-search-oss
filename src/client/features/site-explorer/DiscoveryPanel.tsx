import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Spinner } from "@/client/components/ui/spinner";
import { formatNumber } from "@/client/features/keywords/utils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  DISMISSAL_KINDS,
  DISMISSAL_LABELS,
  type DismissalKind,
} from "@/shared/competitor-dismissal";
import {
  addExplorerCompetitors,
  discoverCompetitors,
  dismissExplorerCompetitors,
  estimateCompetitorDiscovery,
  getCachedCompetitorDiscovery,
  restoreExplorerCompetitor,
} from "@/serverFunctions/site-explorer";
import { INCLUDED_NOTE, plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { gapKeys } from "./gap";

function DismissKindMenu({
  label,
  ariaLabel,
  size,
  variant,
  disabled,
  onPick,
}: {
  label: string;
  ariaLabel?: string;
  size: "sm" | "default";
  variant: "ghost" | "outline";
  disabled: boolean;
  onPick: (kind: DismissalKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={variant}
            size={size}
            disabled={disabled}
            aria-label={ariaLabel}
          />
        }
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          What kind of site is it?
        </p>
        {DISMISSAL_KINDS.map((kind) => (
          <DropdownMenuItem key={kind} onClick={() => onPick(kind)}>
            {DISMISSAL_LABELS[kind]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DiscoveryPanel({
  projectId,
  saved,
}: {
  projectId: string;
  saved: Set<string>;
}) {
  const queryClient = useQueryClient();
  const { showCosts, cost } = useCostDisplay();
  const cachedQuery = useQuery({
    queryKey: ["competitorDiscovery", projectId],
    queryFn: () => getCachedCompetitorDiscovery({ data: { projectId } }),
  });
  const [previewing, setPreviewing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const estimateQuery = useQuery({
    queryKey: ["competitorDiscoveryEstimate", projectId],
    queryFn: () => estimateCompetitorDiscovery({ data: { projectId } }),
    enabled: previewing,
    staleTime: 0,
  });
  const refresh = useMutation({
    mutationFn: () => discoverCompetitors({ data: { projectId } }),
    onSuccess: (result) => {
      if (!result.ok)
        return void toast.error(plainReason(result.reason, showCosts));
      toast.success(`Found ${result.data.items.length} domains`);
      setPreviewing(false);
      void queryClient.invalidateQueries({
        queryKey: ["competitorDiscovery", projectId],
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });
  const add = useMutation({
    mutationFn: () =>
      addExplorerCompetitors({
        data: { projectId, domains: picked, discovered: true },
      }),
    onSuccess: (result) => {
      if (!result.ok)
        return void toast.error(plainReason(result.reason, showCosts));
      toast.success(`${result.data.length} saved`);
      setPicked([]);
      void queryClient.invalidateQueries({
        queryKey: gapKeys.competitors(projectId),
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });

  const afterChange = () => {
    void queryClient.invalidateQueries({
      queryKey: ["competitorDiscovery", projectId],
    });
    void queryClient.invalidateQueries({
      queryKey: gapKeys.competitors(projectId),
    });
  };
  const dismiss = useMutation({
    mutationFn: (input: { domains: string[]; kind: DismissalKind }) =>
      dismissExplorerCompetitors({ data: { projectId, ...input } }),
    onSuccess: (result, input) => {
      if (!result.ok)
        return void toast.error(plainReason(result.reason, showCosts));
      setPicked((current) =>
        current.filter((domain) => !input.domains.includes(domain)),
      );
      toast.success(
        input.domains.length === 1
          ? `${input.domains[0]} is no longer suggested`
          : `${input.domains.length} domains are no longer suggested`,
      );
      afterChange();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });
  const restore = useMutation({
    mutationFn: (domain: string) =>
      restoreExplorerCompetitor({ data: { projectId, domain } }),
    onSuccess: (result) => {
      if (!result.ok)
        return void toast.error(plainReason(result.reason, showCosts));
      afterChange();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });

  const cached = cachedQuery.data;
  const estimate = estimateQuery.data;
  const selectable = (cached?.items ?? [])
    .map((item) => item.domain)
    .filter((domain) => !saved.has(domain));
  const allPicked =
    selectable.length > 0 && selectable.every((d) => picked.includes(d));

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold">Organic competitors</h2>
        <p className="text-sm text-muted-foreground">
          {showCosts ? "Domains DataForSEO sees" : "Domains seen"} ranking for
          the same keywords as yours. Showing the last result kept for this
          market. Looking up again{" "}
          {showCosts ? "costs money" : "is a paid lookup"}, so it only runs when
          you confirm.
        </p>
      </div>

      {cached ? (
        <>
          <p className="text-xs text-muted-foreground">
            Looked up {formatRelativeTime(cached.observedAt)} for{" "}
            {cached.target}. Third-party estimates.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={picked.length === 0 || add.isPending}
              onClick={() => add.mutate()}
            >
              Save {picked.length || ""} selected as competitors
            </Button>
            <DismissKindMenu
              label={`Mark ${picked.length || ""} selected as not competitors`}
              size="default"
              variant="outline"
              disabled={picked.length === 0 || dismiss.isPending}
              onPick={(kind) => dismiss.mutate({ domains: picked, kind })}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="w-8 py-1">
                    <Checkbox
                      checked={allPicked}
                      indeterminate={picked.length > 0 && !allPicked}
                      disabled={selectable.length === 0}
                      aria-label="Select all domains that are not saved"
                      onCheckedChange={(next) =>
                        setPicked(next ? selectable : [])
                      }
                    />
                  </th>
                  <th className="py-1">Domain</th>
                  <th className="py-1 text-right">Shared keywords</th>
                  <th className="py-1 text-right">Avg. position</th>
                  <th className="py-1 text-right">Organic traffic</th>
                  <th className="w-8 py-1" />
                </tr>
              </thead>
              <tbody>
                {cached.items.map((item) => {
                  const isSaved = saved.has(item.domain);
                  return (
                    <tr key={item.domain} className="border-t">
                      <td className="py-1.5">
                        <Checkbox
                          checked={isSaved || picked.includes(item.domain)}
                          disabled={isSaved}
                          aria-label={`Select ${item.domain}`}
                          onCheckedChange={(next) =>
                            setPicked((current) =>
                              next
                                ? [...current, item.domain]
                                : current.filter(
                                    (domain) => domain !== item.domain,
                                  ),
                            )
                          }
                        />
                      </td>
                      <td className="py-1.5 font-medium">
                        {item.domain}
                        {isSaved ? (
                          <Badge className="ml-2" variant="soft">
                            Saved
                          </Badge>
                        ) : null}
                        {cached.suggestedKinds[item.domain] ? (
                          <Badge className="ml-2" variant="outline">
                            Dismissed on another project as{" "}
                            {DISMISSAL_LABELS[
                              cached.suggestedKinds[item.domain]
                            ].toLowerCase()}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatNumber(item.sharedKeywords)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {item.avgPosition === null
                          ? "-"
                          : item.avgPosition.toFixed(1)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatNumber(item.organicTraffic)}
                      </td>
                      <td className="py-1.5 text-right">
                        <DismissKindMenu
                          label="Not a competitor"
                          ariaLabel={`Not a competitor: ${item.domain}`}
                          size="sm"
                          variant="ghost"
                          disabled={dismiss.isPending}
                          onPick={(kind) =>
                            dismiss.mutate({ domains: [item.domain], kind })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {cached.dismissed.length > 0 ? (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Not competitors ({cached.dismissed.length})
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                These are left out of competitor suggestions. They still count
                as link prospects, since a directory or publisher can link to
                you even though it is not a rival.
              </p>
              <ul className="mt-2 divide-y">
                {cached.dismissed.map((row) => (
                  <li
                    key={row.domain}
                    className="flex items-center justify-between gap-2 py-1.5"
                  >
                    <span className="min-w-0 truncate">
                      {row.domain}
                      <Badge className="ml-2" variant="soft">
                        {DISMISSAL_LABELS[row.kind]}
                      </Badge>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(row.domain)}
                    >
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : cachedQuery.isLoading ? (
        <Spinner className="size-4" aria-label="Loading" />
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing looked up yet for this market.
        </p>
      )}

      <div className="border-t pt-3">
        {!previewing ? (
          <Button variant="outline" onClick={() => setPreviewing(true)}>
            {cached ? "Look up again" : "Find organic competitors"}
          </Button>
        ) : estimateQuery.isLoading ? (
          <Spinner
            className="size-4"
            aria-label={showCosts ? "Estimating cost" : "Checking the lookup"}
          />
        ) : estimate ? (
          <div className="space-y-2 text-sm">
            {estimate.available ? (
              <>
                <p>
                  {showCosts ? (
                    <>
                      <strong>Up to {cost(estimate.estimatedUsd)}.</strong>{" "}
                      {estimate.basis}
                    </>
                  ) : (
                    INCLUDED_NOTE
                  )}
                </p>
                <div className="flex gap-2">
                  <Button
                    disabled={refresh.isPending}
                    onClick={() => refresh.mutate()}
                  >
                    {refresh.isPending ? <Spinner /> : null}
                    {showCosts
                      ? `Run for up to ${cost(estimate.estimatedUsd)}`
                      : "Run lookup"}
                  </Button>
                  <Button variant="ghost" onClick={() => setPreviewing(false)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <p role="alert">{plainReason(estimate.reason, showCosts)}</p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
