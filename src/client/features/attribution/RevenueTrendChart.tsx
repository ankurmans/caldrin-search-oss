import { Bar, BarChart } from "recharts";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import { formatMoney } from "@/shared/attribution/money";

const CONFIG: ChartConfig = {
  minor: { label: "Revenue", color: "var(--chart-1)" },
};

/** Net payments per day in the reporting currency. */
export function RevenueTrendChart({
  daily,
  currency,
}: {
  daily: { day: string; currency: string | null; amount: number }[];
  currency: string;
}) {
  const data = daily
    .filter((d) => d.currency === currency)
    .map((d) => ({ day: d.day, minor: d.amount }));
  if (data.every((d) => d.minor === 0))
    return (
      <p className="text-sm text-muted-foreground">
        No payments in this period, so there is nothing to plot.
      </p>
    );
  return (
    <ChartContainer config={CONFIG} className="h-48">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <ChartGrid />
        <ChartXAxis
          dataKey="day"
          tickFormatter={(d: string) =>
            new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })
          }
        />
        <ChartYAxis
          width={48}
          tickFormatter={(v: number) => formatMoney(v, currency)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              valueFormatter={(v) => formatMoney(Number(v), currency)}
            />
          }
        />
        <Bar
          dataKey="minor"
          fill="var(--color-minor)"
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
