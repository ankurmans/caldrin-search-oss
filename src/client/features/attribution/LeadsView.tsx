import { EmptyState } from "@/client/components/EmptyState";
import { ExportMenu } from "@/client/components/ExportMenu";
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
import { exportRows } from "@/client/lib/exportRows";
import type { getAttributionLeadsFn } from "@/serverFunctions/attributionLeads";
import { formatMoney } from "@/shared/attribution/money";
import { CallsPanel } from "./CallsPanel";
import { RoutingPanel } from "./RoutingPanel";
import { useLeadsReport, type ReportParams } from "./attributionQueries";
import {
  channelLabel,
  formatCredited,
  moneyLines,
  percent,
  STAGE_LABELS,
  shortDate,
} from "./format";

type Leads = Awaited<ReturnType<typeof getAttributionLeadsFn>>;

const money = (list: Leads["value"]["contract"], currency: string) =>
  list.length ? moneyLines(list, currency).join(" · ") : "—";

function Tiles({ leads }: { leads: Leads }) {
  const c = leads.reportingCurrency;
  const tiles = [
    {
      label: "Enquiries",
      value: String(leads.totals.enquiries),
      note: leads.totals.duplicateSubjects
        ? `${leads.totals.duplicateSubjects} recorded more than once under one id`
        : "Each person counted once",
    },
    {
      label: "Won contract value",
      value: money(leads.value.contract, c),
      note: "Agreed, not yet cash",
    },
    {
      label: "Collected",
      value: money(leads.value.collected, c),
      note: "Payments received, net of refunds",
    },
    {
      label: "Open pipeline",
      value: money(leads.value.pipeline, c),
      note: "Estimated, not revenue",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-xl border border-border bg-card p-4"
        >
          <dt className="text-xs text-muted-foreground">{t.label}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{t.value}</dd>
          <dd className="mt-0.5 text-xs text-muted-foreground">{t.note}</dd>
        </div>
      ))}
    </dl>
  );
}

function Stages({ leads }: { leads: Leads }) {
  const byStage: Record<string, number> = leads.totals.byStage;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Where enquiries ended up</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Object.entries(STAGE_LABELS).map(([stage, label]) => (
          <li key={stage} className="rounded-lg border bg-card px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold tabular-nums">
              {byStage[stage]}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        The furthest step recorded for each person. A step your system did not
        report is not assumed.
      </p>
    </section>
  );
}

function SourceTable({
  leads,
  params,
}: {
  leads: Leads;
  params: ReportParams;
}) {
  const headers = [
    "Source",
    "Channel",
    "Enquiries",
    "Qualified",
    "Won",
    "Won value",
  ];
  const rows = leads.bySource.map((s) => [
    s.source ?? "",
    channelLabel(s.channel),
    Number(s.enquiries.toFixed(2)),
    Number(s.qualified.toFixed(2)),
    Number(s.won.toFixed(2)),
    s.wonValue.map((m) => formatMoney(m.minor, m.currency)).join(" · "),
  ]);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">By recorded source</h2>
          <p className="text-sm text-muted-foreground">
            Credit under the selected model. {percent(leads.unknownBp)} of
            enquiry credit has no recorded source and stays Unknown.
          </p>
        </div>
        <ExportMenu
          actions={["csv", "json"]}
          onExport={(format) =>
            void exportRows({
              format,
              feature: "attribution_leads",
              headers,
              rows,
              filename: `enquiries-by-source-${params.range}`,
            })
          }
        />
      </div>
      {leads.bySource.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No enquiries with a recorded source in this period.
        </p>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((h, i) => (
                  <TableHead
                    key={h}
                    className={i > 1 ? "text-right" : undefined}
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.bySource.map((s) => (
                <TableRow key={`${s.channel}|${s.source}`}>
                  <TableCell className="font-medium">
                    {s.source ?? "No source recorded"}
                  </TableCell>
                  <TableCell>{channelLabel(s.channel)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCredited(s.enquiries)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCredited(s.qualified)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCredited(s.won)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.wonValue.length
                      ? moneyLines(s.wonValue, leads.reportingCurrency).join(
                          " · ",
                        )
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </section>
  );
}

function OwnWords({ leads }: { leads: Leads }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">In their own words</h2>
        <p className="text-sm text-muted-foreground">
          {leads.totals.withoutOwnWords} of {leads.totals.enquiries} enquiries
          said nothing about how they found you. What the others said is kept
          exactly as written; "Google" means search of an unspecified kind, not
          organic.
        </p>
      </div>
      {leads.selfReported.length === 0 ? null : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>They wrote</TableHead>
                <TableHead>Read as</TableHead>
                <TableHead className="text-right">Enquiries</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.selfReported.map((p) => (
                <TableRow key={p.text}>
                  <TableCell>{p.text}</TableCell>
                  <TableCell>
                    {channelLabel(p.read.channel)}
                    {p.read.source ? ` · ${p.read.source}` : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </section>
  );
}

function Recent({
  leads,
  onOpen,
}: {
  leads: Leads;
  onOpen: (conversionId: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Recent enquiries</h2>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>How</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>They wrote</TableHead>
              <TableHead className="text-right">Contract</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.recent.map((r, i) => (
              <TableRow
                key={`${r.occurredAt}-${r.conversionId}-${i}`}
                className={r.conversionId ? "cursor-pointer" : undefined}
                onClick={() => r.conversionId && onOpen(r.conversionId)}
              >
                <TableCell className="whitespace-nowrap">
                  {r.conversionId ? (
                    <button
                      type="button"
                      className="underline-offset-2 hover:underline focus-visible:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (r.conversionId) onOpen(r.conversionId);
                      }}
                    >
                      {shortDate(r.occurredAt)}
                    </button>
                  ) : (
                    shortDate(r.occurredAt)
                  )}
                </TableCell>
                <TableCell>
                  {r.receivedBrand ?? "—"}
                  {r.intendedBrand && r.intendedBrand !== r.receivedBrand ? (
                    <span className="block text-xs text-warning">
                      meant for {r.intendedBrand}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{r.enquiryChannel ?? "—"}</TableCell>
                <TableCell>{STAGE_LABELS[r.stage] ?? r.stage}</TableCell>
                <TableCell className="max-w-60 truncate">
                  {r.selfReported ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(r.contract, leads.reportingCurrency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </section>
  );
}

/** Leads and revenue: enquiries from any channel to won, collected and open value. */
export function LeadsView({
  params,
  onOpen,
}: {
  params: ReportParams;
  onOpen: (conversionId: string) => void;
}) {
  const query = useLeadsReport(params);
  return (
    <div className="space-y-8">
      <QueryState
        query={query}
        errorFallback="Could not load enquiries"
        loading={<Skeleton className="h-40 w-full" />}
      >
        {(leads) =>
          leads.totals.enquiries === 0 ? (
            <EmptyState
              title="No enquiries recorded in this period"
              description="Send leads, calls, bookings and won deals from your forms, CRM or call tracking: through the event API, a CSV import, or the CRM and call adapters. Only what your systems report appears here."
            />
          ) : (
            <>
              {leads.pendingEvents > 0 ? (
                <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  {leads.pendingEvents} recorded events are still being
                  processed, so people and sources below may be incomplete.
                </p>
              ) : null}
              <Tiles leads={leads} />
              <Stages leads={leads} />
              <SourceTable leads={leads} params={params} />
              <OwnWords leads={leads} />
              <Recent leads={leads} onOpen={onOpen} />
              <p className="text-xs text-muted-foreground">{leads.note}</p>
            </>
          )
        }
      </QueryState>
      <RoutingPanel params={params} />
      <CallsPanel params={params} />
    </div>
  );
}
