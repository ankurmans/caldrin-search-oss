import { QueryState } from "@/client/components/QueryState";
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
import { useRoutingReport, type ReportParams } from "./attributionQueries";
import { moneyLines, shortDate } from "./format";

/** Which brand received each enquiry against which brand it was meant for. */
export function RoutingPanel({ params }: { params: ReportParams }) {
  const query = useRoutingReport(params);
  return (
    <QueryState
      query={query}
      errorFallback="Could not load brand routing"
      loading={<Skeleton className="h-24 w-full" />}
    >
      {(routing) =>
        routing.brands.length === 0 ? null : (
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">Brand routing</h2>
              <p className="text-sm text-muted-foreground">
                {routing.totals.misrouted} of {routing.totals.enquiries}{" "}
                enquiries were received by a brand other than the one they were
                meant for; {routing.totals.intendedNotStated} did not say.
              </p>
            </div>
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received by</TableHead>
                    <TableHead>Meant for</TableHead>
                    <TableHead className="text-right">Enquiries</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routing.matrix.map((m) => (
                    <TableRow key={`${m.receivedBrand}|${m.intendedBrand}`}>
                      <TableCell>{m.receivedBrand}</TableCell>
                      <TableCell>{m.intendedBrand}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.count}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
            {routing.misrouted.length ? (
              <TableCard>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Received</TableHead>
                      <TableHead>Came to</TableHead>
                      <TableHead>Meant for</TableHead>
                      <TableHead>Lead owner</TableHead>
                      <TableHead className="text-right">Contract</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {routing.misrouted.map((m, i) => (
                      <TableRow key={`${m.occurredAt}-${m.conversionId}-${i}`}>
                        <TableCell>{shortDate(m.occurredAt)}</TableCell>
                        <TableCell>{m.receivedBrand}</TableCell>
                        <TableCell>{m.intendedBrand}</TableCell>
                        <TableCell>{m.leadOwner ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.contract.length
                            ? moneyLines(
                                m.contract,
                                routing.reportingCurrency,
                              ).join(" · ")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableCard>
            ) : null}
            <p className="text-xs text-muted-foreground">{routing.note}</p>
          </section>
        )
      }
    </QueryState>
  );
}
