export const RANGE_KEYS = ["7d", "28d", "90d", "365d"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABELS: Record<RangeKey, string> = {
  "7d": "Last 7 days",
  "28d": "Last 28 days",
  "90d": "Last 90 days",
  "365d": "Last 12 months",
};

const DAYS: Record<RangeKey, number> = {
  "7d": 7,
  "28d": 28,
  "90d": 90,
  "365d": 365,
};

/** A window ending now (exclusive of the next instant), as ISO timestamps. */
export function rangeBounds(range: RangeKey, now = new Date()) {
  const to = new Date(now.getTime() + 1000).toISOString();
  const from = new Date(now.getTime() - DAYS[range] * 86_400_000).toISOString();
  return { from, to };
}
