import type { OpportunityRowData } from "./helpers";
import { hasSearchMetrics } from "./helpers";

// Search Console numbers, shown only when they are real for this source.
export function SearchMetrics({
  opportunity,
}: {
  opportunity: OpportunityRowData;
}) {
  if (!hasSearchMetrics(opportunity.dataSource)) return null;
  const { impressions, clicks, ctr, position } = opportunity;
  const items = [
    ["Impressions", impressions.toLocaleString()],
    ["Clicks", clicks.toLocaleString()],
    ["CTR", `${(ctr * 100).toFixed(1)}%`],
    ["Avg. position", position.toFixed(1)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border bg-card p-2.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
