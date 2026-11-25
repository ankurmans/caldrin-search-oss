import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { INCLUDED_NOTE, plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { estimateKeywordGapRun } from "@/serverFunctions/opportunities";
import { opportunitiesKey } from "./helpers";

const PERIODS = { daily: "daily", monthly: "monthly" } as const;

// Paid competitor keyword gaps: asking for them only fetches an estimate. The
// run needs a second, explicit click on the confirm button.
export function PaidKeywordGapPanel({
  projectId,
  running,
  onConfirm,
}: {
  projectId: string;
  running: boolean;
  onConfirm: (repeat: boolean) => void;
}) {
  const { showCosts, cost } = useCostDisplay();
  const [included, setIncluded] = useState(false);
  const estimate = useQuery({
    queryKey: [...opportunitiesKey(projectId), "gap-estimate"],
    queryFn: () => estimateKeywordGapRun({ data: { projectId } }),
    enabled: included,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const data = estimate.data;
  return (
    <div className="space-y-2 rounded-xl border bg-card p-3 md:p-4">
      <div className="flex items-center gap-2">
        <Checkbox
          id="include-paid-gaps"
          checked={included}
          onCheckedChange={(checked) => setIncluded(checked)}
        />
        <Label htmlFor="include-paid-gaps" className="font-normal">
          Include paid competitor keyword gaps
        </Label>
      </div>
      {included ? (
        <div className="space-y-2 text-sm" aria-live="polite">
          {estimate.isPending ? (
            <p className="text-muted-foreground">Estimating the cost…</p>
          ) : estimate.isError || !data ? (
            <p className="text-destructive">
              Could not estimate the cost, so nothing will be run.
            </p>
          ) : data.available && data.estimatedUsd !== null ? (
            <>
              {showCosts ? (
                <>
                  <p>
                    Estimated cost {cost(data.estimatedUsd)}
                    {data.remainingUsd !== null && data.limitPeriod
                      ? ` (${cost(data.remainingUsd)} remaining under the ${PERIODS[data.limitPeriod]} limit)`
                      : " (no spend limit set)"}
                    .
                  </p>
                  <p className="text-muted-foreground">
                    {data.basis} It reads {data.competitorDomains.join(", ")}{" "}
                    from DataForSEO and is charged only if live Search Console
                    data is available. Nothing is fetched until you confirm.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {INCLUDED_NOTE} It reads {data.competitorDomains.join(", ")}{" "}
                  and runs only if live Search Console data is available.
                  Nothing is fetched until you confirm.
                </p>
              )}
              {data.ranToday ? (
                <p className="text-amber-600 dark:text-amber-400">
                  {showCosts
                    ? `Already run today for ${cost(data.ranToday.costUsd)}. Running it again is charged again.`
                    : "Already run today. Running it again uses another paid lookup."}
                </p>
              ) : null}
              <Button
                size="sm"
                pending={running}
                onClick={() => onConfirm(data.ranToday !== null)}
              >
                {data.ranToday
                  ? "Run again and pay again"
                  : "Confirm and run with paid gaps"}
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">
              {plainReason(data.reason, showCosts)}
              {data.estimatedUsd !== null && showCosts
                ? ` Estimated cost ${cost(data.estimatedUsd)}.`
                : ""}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
