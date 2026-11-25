import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogDescription,
} from "@/client/components/ui/dialog";
import { plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import {
  lookUpFanOutKeywordMetrics,
  quoteFanOutKeywordMetrics,
} from "@/serverFunctions/source-intelligence";
import { aiMarketLabel } from "@/shared/ai-visibility";
import {
  canLookUpFanOutTerm,
  FAN_OUT_LOOKUP_LIMIT,
} from "@/shared/fanOutKeyword";
import type { SourceFilters } from "@/types/schemas/source-intelligence";
import { sourceKeys, type QueryTableRow } from "./sourceIntelligence";

export function FanOutKeywordLookup({
  projectId,
  filters,
  rows,
  disabled,
}: {
  projectId: string;
  filters: SourceFilters;
  rows: QueryTableRow[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const { cost, showCosts } = useCostDisplay();
  const terms = rows
    .filter(
      (row) => row.metricsFetchedAt === null && canLookUpFanOutTerm(row.query),
    )
    .slice(0, FAN_OUT_LOOKUP_LIMIT)
    .map((row) => row.query);
  const input = { projectId, filters, terms };
  const quote = useQuery({
    queryKey: ["fan-out-keyword-quote", input],
    queryFn: () => quoteFanOutKeywordMetrics({ data: input }),
    enabled: open && terms.length > 0,
    staleTime: 0,
  });
  const estimate = quote.data?.ok ? quote.data.data : null;
  const lookup = useMutation({
    mutationFn: (maxEstimatedUsd: number) =>
      lookUpFanOutKeywordMetrics({ data: { ...input, maxEstimatedUsd } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(plainReason(result.reason, showCosts));
        return;
      }
      const { checked, reported } = result.data;
      toast.success(
        checked
          ? `Keyword metrics reported for ${reported} of ${checked} searches.`
          : "These searches already have a saved lookup.",
      );
      setOpen(false);
      void client.invalidateQueries({ queryKey: sourceKeys.all(projectId) });
    },
    onError: () => toast.error("The keyword lookup failed. Try again shortly."),
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || !terms.length}
        onClick={() => setOpen(true)}
      >
        Look up keyword metrics
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!lookup.isPending) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Look up keyword metrics</DialogTitle>
            <DialogDescription>
              Fill in missing Google search metrics for reported searches on
              this page.
            </DialogDescription>
          </DialogHeader>
          {quote.isPending ? (
            <p role="status" className="text-sm">
              Preparing estimate…
            </p>
          ) : null}
          {quote.isError ? (
            <p role="alert" className="text-sm">
              Could not prepare the estimate.
            </p>
          ) : null}
          {quote.data && !quote.data.ok ? (
            <p role="alert" className="text-sm">
              {quote.data.reason}
            </p>
          ) : null}
          {estimate ? (
            <div className="space-y-3 text-sm">
              <p>
                {aiMarketLabel(estimate)} · {estimate.keywords.length} eligible{" "}
                {estimate.keywords.length === 1 ? "search" : "searches"}
              </p>
              {estimate.keywords.length > 0 ? (
                <>
                  <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-muted-foreground">
                    {estimate.keywords.map((keyword) => (
                      <li key={keyword}>{keyword}</li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground">
                    {estimate.usingAds
                      ? "This market provides search volume only."
                      : "Search volume and keyword difficulty appear where the provider returns them."}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      size="sm"
                      pending={lookup.isPending}
                      disabled={quote.isFetching}
                      onClick={() => lookup.mutate(estimate.estimatedUsd)}
                    >
                      Run lookup
                    </Button>
                    <span className="text-muted-foreground">
                      {cost(estimate.estimatedUsd)
                        ? `Estimated provider cost ${cost(estimate.estimatedUsd)}`
                        : "Uses your workspace’s provider allowance."}
                    </span>
                  </div>
                </>
              ) : (
                <p>No eligible searches still need a lookup.</p>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
