import { useState } from "react";
import { QueryState } from "@/client/components/QueryState";
import { EmptyState } from "@/client/components/EmptyState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Badge } from "@/client/components/ui/badge";
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
import { EvidenceBadge } from "./EvidenceBadge";
import { channelLabel, percent, shortDate } from "./format";
import { useJourneys, type ReportParams } from "./attributionQueries";

const FILTERS = [
  { value: "money", label: "Payments", kinds: ["payment"] },
  {
    value: "leads",
    label: "Leads",
    kinds: ["lead", "qualified_lead", "booking", "call"],
  },
  { value: "signups", label: "Signups", kinds: ["signup", "activation"] },
  { value: "all", label: "All outcomes", kinds: undefined },
] as const;

const KIND_LABELS: Record<string, string> = {
  payment: "Payment",
  signup: "Signup",
  activation: "Activation",
  lead: "Lead",
  qualified_lead: "Qualified lead",
  booking: "Booking",
  call: "Call",
  deal_won: "Deal won",
};

/** Recent outcomes and the source each one is credited to. Open one for the evidence. */
export function JourneysView({
  params,
  onOpen,
}: {
  params: ReportParams;
  onOpen: (conversionId: string) => void;
}) {
  const [filter, setFilter] =
    useState<(typeof FILTERS)[number]["value"]>("money");
  const kinds = FILTERS.find((f) => f.value === filter)?.kinds;
  const query = useJourneys(params, kinds ? [...kinds] : undefined);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-sm text-muted-foreground">
          Each row is one outcome. Open it to see the event that reported it,
          the identities joined to it, and every visit that was considered.
        </p>
        <SegmentedToggle
          items={FILTERS.map((f) => ({
            value: f.value,
            label: f.label,
            icon: null,
          }))}
          value={filter}
          showLabels
          onChange={setFilter}
        />
      </div>
      <QueryState
        query={query}
        loading={<Skeleton className="h-64 w-full" />}
        errorFallback="Failed to load journeys"
      >
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="No outcomes of this kind in the period" />
          ) : (
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Credited to</TableHead>
                    <TableHead>Evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => onOpen(item.id)}
                    >
                      <TableCell className="whitespace-nowrap">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline focus-visible:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(item.id);
                          }}
                        >
                          {shortDate(item.occurredAt)}
                        </button>
                      </TableCell>
                      <TableCell>
                        {KIND_LABELS[item.kind] ?? item.kind}
                        {item.isFirstPayment ? (
                          <Badge variant="outline" className="ml-1.5">
                            First
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.amountMinor != null && item.currency
                          ? formatMoney(item.amountMinor, item.currency)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {item.credits.map((c, i) => (
                          <div key={i}>
                            {channelLabel(c.channel)}
                            {c.source ? ` · ${c.source}` : ""}
                            {item.credits.length > 1
                              ? ` (${percent(c.bp)})`
                              : ""}
                          </div>
                        ))}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {[
                            ...new Set(item.credits.map((c) => c.evidence)),
                          ].map((e) => (
                            <EvidenceBadge key={e} evidence={e} />
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )
        }
      </QueryState>
    </div>
  );
}
