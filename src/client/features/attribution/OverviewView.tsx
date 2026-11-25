import { QueryState } from "@/client/components/QueryState";
import { EmptyState } from "@/client/components/EmptyState";
import { Badge } from "@/client/components/ui/badge";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  MODEL_LABELS,
  MODEL_DESCRIPTIONS,
} from "@/shared/attribution/vocabulary";
import type { getAttributionOverviewFn } from "@/serverFunctions/attributionReports";
import { ChannelTable } from "./ChannelTable";
import { ModelComparison } from "./ModelComparison";
import { RevenueTrendChart } from "./RevenueTrendChart";
import { moneyLines, percent } from "./format";
import {
  useAttributionOverview,
  type ReportParams,
} from "./attributionQueries";

type Overview = Awaited<ReturnType<typeof getAttributionOverviewFn>>;

const STAGE_LABELS: Record<string, string> = {
  signup: "Signups",
  activation: "Activated",
  lead: "Leads",
  qualified_lead: "Qualified leads",
  booking: "Bookings",
  deal_won: "Deals won",
  payment: "Payments",
};

function Tiles({ overview }: { overview: Overview }) {
  const payments = overview.outcomes.find((o) => o.kind === "payment");
  const refunded = payments?.refunded.some((r) => r.minor > 0);
  const tiles = [
    {
      label: "Revenue",
      value: payments?.revenue.length
        ? moneyLines(payments.revenue, overview.reportingCurrency).join(" · ")
        : "—",
      note: refunded ? "Net of refunds" : "Net of refunds, none in this period",
    },
    {
      label: "Payments",
      value: String(payments?.count ?? 0),
      note: `${payments?.firstPayments ?? 0} first payments`,
    },
    {
      label: "Signups",
      value: String(
        overview.outcomes.find((o) => o.kind === "signup")?.count ?? 0,
      ),
      note: "Reported by your backend",
    },
    {
      label: "Without a recorded source",
      value: percent(overview.unknownBp),
      note: "Kept as Unknown, never moved to a channel",
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

function Funnel({ overview }: { overview: Overview }) {
  const stages = overview.outcomes.filter((o) => o.count > 0);
  const visitors = overview.channels.reduce((n, c) => n + c.visitors, 0);
  const rows = [
    ...(visitors
      ? [
          {
            key: "visitors",
            label: "Visitors",
            count: visitors,
          },
        ]
      : []),
    ...stages.map((s) => ({
      key: s.kind,
      label: STAGE_LABELS[s.kind] ?? s.kind,
      count: s.count,
    })),
  ];
  if (rows.length === 0) return null;
  const top = Math.max(...rows.map((r) => r.count));
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Funnel</h2>
      <ol className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.key}
            className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3 text-sm"
          >
            <span className="truncate text-muted-foreground">{r.label}</span>
            <span className="h-2 rounded-full bg-muted">
              <span
                className="block h-2 rounded-full bg-primary"
                style={{ width: `${Math.max((r.count / top) * 100, 2)}%` }}
              />
            </span>
            <span className="text-right tabular-nums">{r.count}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Body({
  overview,
  params,
}: {
  overview: Overview;
  params: ReportParams;
}) {
  const empty =
    overview.channels.length === 0 &&
    overview.outcomes.every((o) => o.count === 0);
  if (empty)
    return (
      <EmptyState
        title="No outcomes in this period"
        description={
          overview.demoAvailable && !overview.demo
            ? "Nothing has been recorded yet. Turn on demo data to see what a populated view looks like, or install the tracker and connect payments in Project Settings."
            : "Install the tracker and send signups and payments from your backend or Stripe, or import a CSV, in Project Settings, Integrations."
        }
      />
    );
  return (
    <div className="space-y-8">
      <Tiles overview={overview} />
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Revenue by source</h2>
            <p className="text-sm text-muted-foreground">
              <Badge variant="outline" className="mr-1.5">
                {MODEL_LABELS[overview.model]}
              </Badge>
              {MODEL_DESCRIPTIONS[overview.model]}
            </p>
          </div>
        </div>
        <ChannelTable overview={overview} />
      </section>
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Revenue per day</h2>
          <RevenueTrendChart
            daily={overview.daily}
            currency={overview.reportingCurrency}
          />
        </section>
        <Funnel overview={overview} />
      </div>
      <ModelComparison params={params} />
    </div>
  );
}

export function OverviewView({ params }: { params: ReportParams }) {
  const query = useAttributionOverview(params);
  return (
    <QueryState
      query={query}
      loading={<Skeleton className="h-72 w-full" />}
      errorFallback="Failed to load the attribution overview"
    >
      {(overview) => <Body overview={overview} params={params} />}
    </QueryState>
  );
}
