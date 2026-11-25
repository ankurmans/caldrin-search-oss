import { SpendLimitRefusal, type SpendLimits } from "../types";

// provider_costs.created_at is text on both dialects: SQLite writes
// "YYYY-MM-DD HH:MM:SS", Postgres (and recordCost) write ISO "…T…Z". Both start
// with the UTC date, so comparing against a date prefix with >= is correct on
// either format.
export function windowStarts(now: Date): { day: string; month: string } {
  const day = now.toISOString().slice(0, 10);
  return { day, month: `${day.slice(0, 7)}-01` };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const usd = (n: number) => `$${round6(n).toFixed(4)}`;

export function validateLimits(limits: SpendLimits): void {
  for (const [name, value] of [
    ["dailyUsd", limits.dailyUsd],
    ["monthlyUsd", limits.monthlyUsd],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new SpendLimitRefusal(`${name} must be a number of 0 or more.`);
    }
  }
  const jobs = limits.scheduledJobsPerDay;
  if (jobs !== null && (!Number.isInteger(jobs) || jobs < 0)) {
    throw new SpendLimitRefusal(
      "scheduledJobsPerDay must be a whole number of 0 or more.",
    );
  }
}

export function validateUsd(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new SpendLimitRefusal(`${name} must be a number of 0 or more.`);
  }
}

export function hasUsdLimit(limits: SpendLimits | null): limits is SpendLimits {
  return !!limits && (limits.dailyUsd !== null || limits.monthlyUsd !== null);
}

// Throws when actual recorded spend plus the estimate would pass a set limit.
export function checkAgainstLimits(input: {
  limits: SpendLimits;
  todayUsd: number;
  monthUsd: number;
  estimatedUsd: number;
  label: string;
}): void {
  const { limits, todayUsd, monthUsd, estimatedUsd, label } = input;
  for (const [period, limit, spent] of [
    ["daily", limits.dailyUsd, todayUsd],
    ["monthly", limits.monthlyUsd, monthUsd],
  ] as const) {
    if (limit === null) continue;
    if (round6(spent + estimatedUsd) > round6(limit)) {
      throw new SpendLimitRefusal(
        `${label} not run: it would pass this project's ${period} spend limit of ${usd(limit)} (spent ${usd(spent)} so far this ${period === "daily" ? "UTC day" : "UTC month"}, this operation is estimated at ${usd(estimatedUsd)}). Raise the limit in spend settings or try later.`,
      );
    }
  }
}

// The most the next paid operation can cost before a USD limit is passed, and
// which limit is the binding one. Null when no USD limit is set.
export function remainingUsd(
  limits: SpendLimits,
  spent: { todayUsd: number; monthUsd: number },
): { usd: number; period: "daily" | "monthly" } | null {
  const options = [
    ["daily", limits.dailyUsd, spent.todayUsd],
    ["monthly", limits.monthlyUsd, spent.monthUsd],
  ] as const;
  let best: { usd: number; period: "daily" | "monthly" } | null = null;
  for (const [period, limit, used] of options) {
    if (limit === null) continue;
    const left = Math.max(0, round6(limit - used));
    if (!best || left < best.usd) best = { usd: left, period };
  }
  return best;
}
