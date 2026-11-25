import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
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
  ChangeVerdict,
  MetricChange,
  Rate,
  SideMeasurement,
  WindowComparison,
} from "@/server/features/ai-visibility/services/aiMeasurementTypes";
import { formatPercent, humanize } from "./helpers";

const VERDICT_TEXT: Record<ChangeVerdict, string> = {
  not_assessable: "Not assessable",
  insufficient_runs: "Too few runs to assess",
  within_noise: "Within noise",
  outside_noise: "Outside noise (says nothing about cause)",
};

function rateText(rate: Rate): string {
  if (rate.denominator === 0) return "no answers";
  return `${formatPercent(rate.rate)} (${rate.numerator} / ${rate.denominator})`;
}

function differenceText(value: number | null): string {
  if (value === null) return "-";
  const points = (value * 100).toFixed(1);
  return `${value > 0 ? "+" : ""}${points} pts`;
}

export function AiComparisonView({
  comparison,
  linking,
  onLink,
}: {
  comparison: WindowComparison;
  linking: boolean;
  onLink: () => void;
}) {
  return (
    <div className="space-y-4" aria-live="polite">
      {comparison.comparable ? null : (
        <Alert variant="destructive">
          <AlertTitle>These sets are not comparable</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {comparison.reasons.map((reason) => (
                <li key={reason.code}>{reason.message}</li>
              ))}
            </ul>
            <p>No before and after difference is shown.</p>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Sample reliability:</span>
        <Badge
          variant={
            comparison.reliability === "adequate" ? "success" : "warning"
          }
        >
          {humanize(comparison.reliability)}
        </Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SideCard title="Before" side={comparison.before} />
        <SideCard title="After" side={comparison.after} />
      </div>
      {comparison.changes ? (
        <ChangesTable
          overall={comparison.changes.overall}
          note={comparison.attributionNote}
        />
      ) : null}
      {comparison.comparable ? (
        <Button size="sm" pending={linking} onClick={onLink}>
          Link to this change
        </Button>
      ) : null}
    </div>
  );
}

function SideCard({ title, side }: { title: string; side: SideMeasurement }) {
  return (
    <div className="space-y-1 rounded-lg border p-3 text-sm">
      <h3 className="font-medium">{title}</h3>
      <p>
        {side.runCount} runs, {side.contributingRuns} with answers
        {side.unfinishedRuns > 0 ? `, ${side.unfinishedRuns} unfinished` : ""}
      </p>
      <p className="text-xs text-muted-foreground">{side.repeatRuns.note}</p>
      <p className="text-xs text-muted-foreground">
        Answers used: {side.overall.counts.answered} of{" "}
        {side.overall.counts.planned} planned
        {side.overall.counts.excluded > 0
          ? ` (${side.overall.counts.excluded} left out: no answer, failed or pending)`
          : ""}
      </p>
      {side.engines.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Engines: {side.engines.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function ChangesTable({
  overall,
  note,
}: {
  overall: {
    mention: MetricChange;
    ownCitation: MetricChange;
    recommendation: MetricChange;
  };
  note: string;
}) {
  const rows = [
    ["Brand mentioned", overall.mention],
    ["Own page cited", overall.ownCitation],
    ["Brand recommended", overall.recommendation],
  ] as const;
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">Recorded before</TableHead>
            <TableHead className="text-right">Recorded after</TableHead>
            <TableHead className="text-right">Difference</TableHead>
            <TableHead>Reading</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([label, change]) => (
            <TableRow key={label}>
              <TableCell>{label}</TableCell>
              <TableCell className="text-right tabular-nums">
                {rateText(change.before)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {rateText(change.after)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {differenceText(change.difference)}
              </TableCell>
              <TableCell className="whitespace-normal">
                {VERDICT_TEXT[change.verdict]}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
