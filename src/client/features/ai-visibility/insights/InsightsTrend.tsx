import { useState } from "react";
import { CalendarDays, ListOrdered } from "lucide-react";
import { Line, LineChart, ReferenceLine } from "recharts";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import { AI_ENGINE_LABELS } from "@/shared/ai-visibility";
import type { AiVisibilityIntelligence } from "@/shared/ai-visibility-intelligence";
import { ofText, shortDate } from "./insightsShared";

const SEGMENT_COLORS = ["#ca8a04", "#2563eb", "#0d9488", "#7c3aed"];
const keyOf = (index: number) => `segment${index}`;

type Granularity = "day" | "run";
const GRANULARITIES = [
  {
    value: "day" as const,
    label: "Per collection day",
    icon: <CalendarDays className="size-3.5" />,
  },
  {
    value: "run" as const,
    label: "Per run",
    icon: <ListOrdered className="size-3.5" />,
  },
];

interface TrendPoint {
  at: string;
  promptSetVersionId: string | null;
  visibility: number | null;
  detail: string;
}

function pointsFor(
  data: AiVisibilityIntelligence,
  granularity: Granularity,
): TrendPoint[] {
  if (granularity === "run")
    return data.trend.map((point) => ({
      at: point.at,
      promptSetVersionId: point.promptSetVersionId,
      visibility: point.visibility,
      detail: `${new Date(point.at).toLocaleString()} · ${point.answers} answers`,
    }));
  return data.collectionTrend.map((point) => ({
    at: `${point.date}T00:00:00.000Z`,
    promptSetVersionId: point.promptSetVersionId,
    visibility: point.visibility,
    detail: `${point.date} UTC · ${point.runs} run(s) · named in ${ofText(point.mention)} answers · ${point.prompts} prompt(s) · ${point.engines.map((e) => AI_ENGINE_LABELS[e]).join(", ") || "no engines"}`,
  }));
}

/**
 * One point per collection day (runs of one prompt set on the same UTC day,
 * pooled) or per run. Each prompt set gets its own line, so the chart never
 * joins figures measured on different prompt lists.
 */
export function InsightsTrend({ data }: { data: AiVisibilityIntelligence }) {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const points = pointsFor(data, granularity);
  const segments: string[] = [];
  const changes: number[] = [];
  const rows = points.map((point, index) => {
    const key = point.promptSetVersionId ?? "unversioned";
    if (segments.at(-1) !== key) {
      if (segments.length) changes.push(index);
      segments.push(key);
    }
    return {
      index,
      at: point.at,
      detail: point.detail,
      [keyOf(segments.length - 1)]:
        point.visibility === null
          ? null
          : Math.round(point.visibility * 1000) / 10,
    };
  });
  const config: ChartConfig = Object.fromEntries(
    segments.map((_, index) => [
      keyOf(index),
      {
        label:
          segments.length > 1 ? `Prompt set ${index + 1}` : "AI visibility",
        color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
      },
    ]),
  );
  const unit = granularity === "day" ? "collection day" : "run";
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4 md:p-6"
      aria-label="AI visibility trend"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">AI visibility per {unit}</h3>
          <p className="text-xs text-muted-foreground">
            {points.length} {unit}(s) in the last {data.window.days} days
            {granularity === "day"
              ? ". Runs of one prompt set on the same UTC day are pooled."
              : ""}
          </p>
        </div>
        <SegmentedToggle
          items={GRANULARITIES}
          value={granularity}
          onChange={setGranularity}
          showLabels
        />
      </div>
      {rows.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? "No runs in this period."
            : `One ${unit} so far. A trend needs at least two of the same prompt set.`}
        </p>
      ) : (
        <ChartContainer
          config={config}
          className="h-[220px]"
          aria-label={`AI visibility per ${unit}`}
        >
          <LineChart
            data={rows}
            margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
          >
            <ChartGrid />
            <ChartXAxis
              dataKey="index"
              scale="band"
              tickFormatter={(v: number) => shortDate(rows[v]?.at ?? "")}
            />
            <ChartYAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => rows[Number(label)]?.detail ?? ""}
                  valueFormatter={(value) => `${String(value)}%`}
                />
              }
            />
            {changes.map((index) => (
              <ReferenceLine
                key={index}
                x={index}
                strokeDasharray="4 4"
                stroke="var(--muted-foreground)"
              />
            ))}
            {segments.map((_, index) => (
              <Line
                key={keyOf(index)}
                type="monotone"
                dataKey={keyOf(index)}
                stroke={`var(--color-${keyOf(index)})`}
                strokeWidth={2}
                dot={rows.length < 40}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      )}
      {segments.length > 1 ? (
        <p className="text-xs text-warning">
          The prompt set changed in this period (dashed line). Lines are not
          joined across the change, and only the selected prompt set is in the
          figures above.
        </p>
      ) : null}
    </section>
  );
}
