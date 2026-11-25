import { Info, X } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { actionLabel, humanizeRule } from "./helpers";

export type RunSummaryData = {
  stored: number;
  byAction: Record<string, number>;
  skipped: { rule: string; reason: string }[];
  paid: { ran: boolean; costUsd?: number | null };
  reconciled?: { removed: number; keptStale: number };
};

export function RunSummary({
  summary,
  onDismiss,
}: {
  summary: RunSummaryData;
  onDismiss: () => void;
}) {
  const { cost } = useCostDisplay();
  const breakdown = Object.entries(summary.byAction)
    .map(([action, count]) => `${count} × ${actionLabel(action)}`)
    .join(", ");
  return (
    <Alert variant={summary.skipped.length > 0 ? "warning" : "success"}>
      <Info aria-hidden />
      <AlertTitle>
        Analysis finished: {summary.stored}{" "}
        {summary.stored === 1 ? "opportunity" : "opportunities"} updated
      </AlertTitle>
      <AlertDescription className="space-y-2">
        {breakdown ? <p>{breakdown}</p> : null}
        {summary.reconciled ? (
          <p>
            {summary.reconciled.removed}{" "}
            {summary.reconciled.removed === 1 ? "opportunity" : "opportunities"}{" "}
            the analysis no longer found{" "}
            {summary.reconciled.removed === 1 ? "was" : "were"} removed.{" "}
            {summary.reconciled.keptStale} kept because they have a draft,
            change, in-progress status or dismissal; they are marked &quot;No
            longer found in the latest analysis&quot;.
          </p>
        ) : null}
        {summary.skipped.length > 0 ? (
          <div>
            <p className="font-medium">Not checked, so nothing was guessed:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {summary.skipped.map((item) => (
                <li key={`${item.rule}-${item.reason}`}>
                  {humanizeRule(item.rule)}: {item.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {summary.paid.ran ? (
          <p>
            Paid keyword-gap research ran
            {cost(summary.paid.costUsd)
              ? `; recorded cost ${cost(summary.paid.costUsd)}`
              : ""}
            .
          </p>
        ) : (
          <p>Paid keyword-gap research was not run.</p>
        )}
        <Button size="xs" variant="outline" onClick={onDismiss}>
          <X aria-hidden /> Dismiss message
        </Button>
      </AlertDescription>
    </Alert>
  );
}
