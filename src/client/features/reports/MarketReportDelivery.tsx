import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getMarketDelivery,
  setMarketDelivery,
  stopMarketDelivery,
} from "@/serverFunctions/reports";

export function MarketReportDelivery({
  input,
  canSchedule,
}: {
  input: {
    projectId: string;
    days: 7 | 28 | 90;
    markets: { locationCode: number; languageCode: string }[];
  };
  canSchedule: boolean;
}) {
  const [cadence, setCadence] = useState<7 | 28>(7);
  const status = useQuery({
    queryKey: ["market-delivery", input.projectId],
    queryFn: () => getMarketDelivery({ data: { projectId: input.projectId } }),
  });
  const update = useMutation({
    mutationFn: (active: boolean) =>
      active
        ? setMarketDelivery({ data: { ...input, cadence } })
        : stopMarketDelivery({ data: { projectId: input.projectId } }),
    onSuccess: () => void status.refetch(),
  });
  if (!status.data) return null;
  const { schedule, configured } = status.data;
  return (
    <div className="space-y-2 border-t pt-3">
      <h3 className="font-medium">Scheduled delivery</h3>
      <p className="text-muted-foreground">
        A private report link goes to your verified account email. The report
        uses your selected markets.
      </p>
      {schedule ? (
        <p>
          Every {schedule.cadence === 7 ? "week" : "four weeks"} · Next{" "}
          {schedule.nextRunAt.slice(0, 10)} (UTC)
          {schedule.lastStatus ? ` · ${schedule.lastStatus}` : ""}
        </p>
      ) : null}
      {!configured ? (
        <p className="text-muted-foreground">
          Email delivery is unavailable on this deployment.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {configured ? (
          <>
            <label className="flex items-center gap-2">
              Frequency
              <select
                className="rounded-md border bg-background px-2 py-1"
                value={cadence}
                onChange={(event) =>
                  setCadence(event.target.value === "28" ? 28 : 7)
                }
              >
                <option value={7}>Weekly</option>
                <option value={28}>Every four weeks</option>
              </select>
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={!canSchedule || update.isPending}
              onClick={() => update.mutate(true)}
            >
              {schedule ? "Update schedule" : "Schedule email"}
            </Button>
          </>
        ) : null}
        {schedule ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() => update.mutate(false)}
          >
            Stop delivery
          </Button>
        ) : null}
      </div>
      {update.isError ? (
        <p role="alert">
          {getStandardErrorMessage(update.error, "Could not update delivery.")}
        </p>
      ) : null}
    </div>
  );
}
