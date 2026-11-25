import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  EVIDENCE_LABELS,
  EVIDENCE_LEVELS,
  type Evidence,
} from "@/shared/attribution/vocabulary";
import type { getAttributionOverviewFn } from "@/serverFunctions/attributionReports";
import {
  EVIDENCE_BADGE,
  channelLabel,
  formatCredited,
  moneyLines,
  percent,
} from "./format";
import { Badge } from "@/client/components/ui/badge";

type Overview = Awaited<ReturnType<typeof getAttributionOverviewFn>>;

/** The strongest evidence level present in a channel's credit, with its share. */
function EvidenceMix({ bp }: { bp: Record<Evidence, number> }) {
  const total = EVIDENCE_LEVELS.reduce((s, e) => s + bp[e], 0);
  if (total === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {EVIDENCE_LEVELS.filter((e) => bp[e] > 0).map((e) => (
        <Badge key={e} variant={EVIDENCE_BADGE[e]}>
          {EVIDENCE_LABELS[e]} {percent(Math.round((bp[e] / total) * 10000))}
        </Badge>
      ))}
    </div>
  );
}

/** Where outcomes and revenue came from, under the selected model. */
export function ChannelTable({ overview }: { overview: Overview }) {
  const { channels, reportingCurrency } = overview;
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Visitors</TableHead>
            <TableHead className="text-right">Signups</TableHead>
            <TableHead className="text-right">Leads</TableHead>
            <TableHead className="text-right">Payments</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead>How we know</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {channels.map((row) => (
            <TableRow key={row.channel}>
              <TableCell className="font-medium">
                {channelLabel(row.channel)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.visitors || "—"}
              </TableCell>
              {(["signup", "lead", "payment"] as const).map((kind) => (
                <TableCell key={kind} className="text-right tabular-nums">
                  {row.credited[kind]
                    ? formatCredited(row.credited[kind])
                    : "—"}
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums">
                {row.revenue.length ? (
                  moneyLines(row.revenue, reportingCurrency).map((line) => (
                    <div key={line}>{line}</div>
                  ))
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <EvidenceMix bp={row.evidenceBp} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
