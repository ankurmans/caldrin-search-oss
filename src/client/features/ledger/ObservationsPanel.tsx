import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SectionHeader } from "@/client/components/PageHeader";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type {
  CollectGscResult,
  LedgerEntry,
  LedgerObservation,
  WindowOutcome,
} from "@/server/features/ledger/types";
import { collectLedgerObservations } from "@/serverFunctions/ledger";
import { FinalDecision } from "./FinalDecision";
import {
  formatDay,
  formatNumber,
  formatTime,
  humanize,
  ledgerEntryKey,
  unwrap,
} from "./helpers";

const OUTCOME_TEXT: Record<WindowOutcome["status"], string> = {
  recorded: "Recorded",
  already_recorded: "Already recorded",
  no_data: "No data returned",
  too_early: "Too early to read",
  unavailable: "Unavailable",
};

export function ObservationsPanel({
  projectId,
  entry,
  observations,
  attributionNote,
}: {
  projectId: string;
  entry: LedgerEntry;
  observations: LedgerObservation[];
  attributionNote: string;
}) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<CollectGscResult | null>(null);
  const collect = useMutation({
    mutationFn: () =>
      collectLedgerObservations({ data: { projectId, entryId: entry.id } }),
    onSuccess: (result) => {
      const data = unwrap(result);
      if (data) setOutcome(data);
      void queryClient.invalidateQueries({
        queryKey: ledgerEntryKey(projectId, entry.id),
      });
    },
  });
  const baseline = observations.filter((o) => o.phase === "baseline");
  const followUp = observations.filter((o) => o.phase === "follow_up");

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Recorded observations"
        action={
          <Button
            size="sm"
            variant="outline"
            pending={collect.isPending}
            onClick={() => collect.mutate()}
          >
            Collect Search Console observations
          </Button>
        }
      />
      <Alert variant="info">
        <AlertDescription>{attributionNote}</AlertDescription>
      </Alert>
      {outcome ? <CollectOutcome outcome={outcome} /> : null}
      <ObservationTable
        title="Recorded before the change (baseline)"
        rows={baseline}
        executedAt={entry.executedAt}
        emptyText="No baseline observation has been recorded."
      />
      <ObservationTable
        title="Recorded after the change (follow-up)"
        rows={followUp}
        executedAt={entry.executedAt}
        emptyText="No follow-up observation has been recorded."
      />
      <FinalDecision projectId={projectId} entry={entry} />
    </section>
  );
}

function CollectOutcome({ outcome }: { outcome: CollectGscResult }) {
  return (
    <ul className="space-y-1 rounded-lg border p-3 text-sm" aria-live="polite">
      {(
        [
          ["Before window", outcome.baseline],
          ["After window", outcome.followUp],
        ] as const
      ).map(([label, window]) => (
        <li key={label}>
          <span className="font-medium">{label}: </span>
          {OUTCOME_TEXT[window.status]}
          {window.status === "recorded" ? ` (${window.recorded} readings)` : ""}
          {window.window
            ? `, ${formatDay(window.window.start)} to ${formatDay(window.window.end)}`
            : ""}
          {window.note ? `. ${window.note}` : ""}
        </li>
      ))}
    </ul>
  );
}

// A follow-up window that starts before the change was executed contains days
// from before it, so its reading mixes both periods.
function overlapsChange(row: LedgerObservation, executedAt: string | null) {
  if (row.phase !== "follow_up" || !executedAt || !row.windowStart) {
    return false;
  }
  return row.windowStart < executedAt;
}

function ObservationTable({
  title,
  rows,
  executedAt,
  emptyText,
}: {
  title: string;
  rows: LedgerObservation[];
  executedAt: string | null;
  emptyText: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Num / denom</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Observed</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{humanize(row.metric)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.value)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.numerator === null && row.denominator === null
                    ? "-"
                    : `${formatNumber(row.numerator)} / ${formatNumber(row.denominator)}`}
                </TableCell>
                <TableCell>
                  {row.windowStart
                    ? `${formatDay(row.windowStart)} to ${formatDay(row.windowEnd)}`
                    : "-"}
                </TableCell>
                <TableCell>{row.source}</TableCell>
                <TableCell>{formatTime(row.observedAt)}</TableCell>
                <TableCell className="min-w-48 whitespace-normal">
                  {overlapsChange(row, executedAt) ? (
                    <Badge variant="warning" className="mb-1 h-auto">
                      Window overlaps the change
                    </Badge>
                  ) : null}
                  {row.note ? (
                    <p className="text-xs text-muted-foreground">{row.note}</p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
