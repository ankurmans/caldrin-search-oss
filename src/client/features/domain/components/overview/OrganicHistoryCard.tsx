import { Line, LineChart } from "recharts";
import { QueryError } from "@/client/components/QueryState";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import { HelpLabel } from "@/client/components/HelpLabel";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import {
  formatMonthLabel,
  formatNumber,
  formatTooltipValue,
} from "@/client/features/backlinks/backlinksPageUtils";
import {
  DATAFORSEO_ESTIMATE,
  SourceNote,
} from "@/client/features/domain/components/overview/SourceNote";
import type { useDomainHistoryQuery } from "@/client/features/domain/hooks/useDomainHistoryQuery";

type HistoryQuery = ReturnType<typeof useDomainHistoryQuery>;
type Month = NonNullable<HistoryQuery["data"]>["months"][number];

const chartConfig = {
  keywords: { label: "Organic keywords", color: "#2563eb" },
  traffic: { label: "Est. organic traffic", color: "#e69f00" },
} satisfies ChartConfig;

const BANDS = [
  { key: "top1", label: "1", color: "#15803d" },
  { key: "top2to3", label: "2-3", color: "#4d9a54" },
  { key: "top4to10", label: "4-10", color: "#e69f00" },
  { key: "top11to20", label: "11-20", color: "#f0b95b" },
  { key: "top21to50", label: "21-50", color: "#94a3b8" },
  { key: "top51to100", label: "51-100", color: "#cbd5e1" },
] as const;

function axisValue(value: unknown) {
  if (typeof value !== "number") return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

function monthTick(value: unknown) {
  return typeof value === "string" ? formatMonthLabel(value) : "";
}

function PositionBands({
  positions,
}: {
  positions: NonNullable<Month["positions"]>;
}) {
  const total = BANDS.reduce((sum, band) => sum + positions[band.key], 0);
  if (total === 0) return null;
  return (
    <div className="space-y-2">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label="Organic keywords by ranking position"
      >
        {BANDS.map((band) => (
          <div
            key={band.key}
            style={{
              width: `${(positions[band.key] / total) * 100}%`,
              backgroundColor: band.color,
            }}
          />
        ))}
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs sm:grid-cols-6">
        {BANDS.map((band) => (
          <div key={band.key} className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: band.color }}
            />
            <dt className="text-muted-foreground">#{band.label}</dt>
            <dd className="ml-auto tabular-nums">
              {formatNumber(positions[band.key])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Movement({ month }: { month: Month }) {
  const items = [
    { label: "New", value: month.movement.newKeywords },
    { label: "Rising", value: month.movement.risingKeywords },
    { label: "Declining", value: month.movement.decliningKeywords },
    { label: "Lost", value: month.movement.lostKeywords },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-border p-2">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatNumber(item.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Twelve months of organic keywords and traffic, with the latest month's detail. */
export function OrganicHistoryCard({
  query,
  currentPositions,
  onLoad,
}: {
  query: HistoryQuery;
  /** Today's bands from the live overview, so they sum to the headline count. */
  currentPositions: Month["positions"];
  /** Set while only stored data is shown: reads the history when asked. */
  onLoad?: () => void;
}) {
  if (query.isLoading) {
    return (
      <Card className="gap-3 p-4" aria-busy>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-56 w-full" />
      </Card>
    );
  }
  if (query.isError) {
    return (
      <QueryError
        variant="card"
        error={query.error}
        fallback="Organic history failed to load."
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }

  if (query.data === undefined && onLoad) {
    return (
      <Card className="flex-row flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          Monthly history has not been read for this domain yet.
        </p>
        <Button variant="outline" size="sm" onClick={onLoad}>
          Load history
        </Button>
      </Card>
    );
  }

  const months = query.data?.months ?? [];
  const latest = months.at(-1);
  const positions = currentPositions ?? latest?.positions ?? null;
  if (!latest) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        The provider has no monthly history for this domain in this market.
      </Card>
    );
  }

  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          <HelpLabel
            label="Organic search trend"
            helpText="Monthly organic keywords and estimated traffic as aggregated by the provider. Each point is that month's provider snapshot."
          />
        </h2>
        <SourceNote
          source={`${DATAFORSEO_ESTIMATE} · months ${months[0]?.month} to ${latest.month}`}
          date={query.data?.fetchedAt}
        />
      </div>
      <ChartContainer
        config={chartConfig}
        className="h-56"
        aria-label="Organic keywords and estimated traffic by month"
      >
        <LineChart
          data={months}
          margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
        >
          <ChartGrid />
          <ChartXAxis
            dataKey="month"
            tickFormatter={monthTick}
            minTickGap={24}
          />
          <ChartYAxis yAxisId="left" tickFormatter={axisValue} width={50} />
          <ChartYAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={axisValue}
            width={50}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={monthTick}
                valueFormatter={formatTooltipValue}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="keywords"
            stroke="var(--color-keywords)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="traffic"
            stroke="var(--color-traffic)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartContainer>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Keywords by position, current</h3>
        {positions ? <PositionBands positions={positions} /> : null}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">
          Keyword movement in {formatMonthLabel(latest.month)}
        </h3>
        <Movement month={latest} />
      </div>
    </Card>
  );
}
