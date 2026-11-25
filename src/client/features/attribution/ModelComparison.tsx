import { useState } from "react";
import { ExportMenu } from "@/client/components/ExportMenu";
import { Badge } from "@/client/components/ui/badge";
import { exportRows } from "@/client/lib/exportRows";
import { QueryState } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { formatMoney } from "@/shared/attribution/money";
import { MODEL_LABELS } from "@/shared/attribution/vocabulary";
import { channelLabel, formatCredited } from "./format";
import { useModelComparison, type ReportParams } from "./attributionQueries";

const KINDS = [
  { value: "payment", label: "Revenue" },
  { value: "lead", label: "Leads" },
  { value: "signup", label: "Signups" },
  { value: "qualified_lead", label: "Qualified" },
  { value: "call", label: "Calls" },
  { value: "deal_won", label: "Won value" },
] as const;

const MONEY_KINDS = new Set(["payment", "deal_won"]);

/** Every model's answer to the same question, so a number is never one model's opinion alone. */
export function ModelComparison({ params }: { params: ReportParams }) {
  const [kind, setKind] = useState<string>("payment");
  const query = useModelComparison(params, kind);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Compare models</h2>
          <p className="text-sm text-muted-foreground">
            The same outcomes, credited seven ways. First and last touch bracket
            the range of honest answers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedToggle
            items={KINDS.map((k) => ({ ...k, icon: null }))}
            value={kind}
            showLabels
            onChange={setKind}
          />
          <ExportMenu
            actions={["csv", "json"]}
            disabled={!query.data?.rows.length}
            onExport={(format) => {
              const data = query.data;
              if (!data) return;
              void exportRows({
                format,
                feature: "attribution_model_comparison",
                headers: ["Source", ...data.models.map((m) => MODEL_LABELS[m])],
                rows: data.rows.map((row) => [
                  channelLabel(row.channel),
                  ...row.cells.map((c) =>
                    MONEY_KINDS.has(kind)
                      ? formatMoney(c.minor, data.reportingCurrency)
                      : Number(c.credited.toFixed(2)),
                  ),
                ]),
                filename: `model-comparison-${kind}-${params.range}`,
              });
            }}
          />
        </div>
      </div>
      <QueryState
        query={query}
        loading={<Skeleton className="h-40 w-full" />}
        errorFallback="Failed to compare models"
      >
        {(data) =>
          data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No outcomes of this kind in the period.
            </p>
          ) : (
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    {data.models.map((m) => (
                      <TableHead key={m} className="text-right">
                        {MODEL_LABELS[m]}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row) => (
                    <TableRow key={row.channel}>
                      <TableCell className="font-medium">
                        {channelLabel(row.channel)}
                        {row.modelDependent ? (
                          <Badge
                            variant="warning"
                            className="ml-2"
                            title="The models disagree by half again or more. Treat this channel's number as a range, not a finding."
                          >
                            Model-dependent
                          </Badge>
                        ) : null}
                      </TableCell>
                      {row.cells.map((cell) => (
                        <TableCell
                          key={cell.model}
                          className="text-right tabular-nums"
                        >
                          {MONEY_KINDS.has(kind)
                            ? formatMoney(cell.minor, data.reportingCurrency)
                            : formatCredited(cell.credited)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )
        }
      </QueryState>
    </section>
  );
}
