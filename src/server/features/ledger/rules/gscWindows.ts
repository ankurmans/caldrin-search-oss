// Fixed measurement windows for a change, and how a window's Search Console
// rows become observations. Pure: no clock, no I/O. Nothing here estimates or
// fills in a missing reading; a window with no rows yields no observation.

const WINDOW_DAYS = 28;
const GSC_LAG_DAYS = 3;
const MIN_DAYS_BEFORE_FOLLOW_UP = 7;

const DAY_MS = 86_400_000;

export type DayWindow = { start: string; end: string };

type GscWindowPlan = {
  baseline: DayWindow;
  // Search Console trails by days: a baseline ending inside the lag is not
  // complete yet.
  baselineReady: boolean;
  followUp:
    | { status: "ready"; window: DayWindow; daysBeforeChange: number }
    | { status: "too_early"; readyOn: string };
};

type GscTotals = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  positionTimesImpressions: number;
};

type GscObservationDraft = {
  metric: "clicks" | "impressions" | "ctr" | "position";
  value: number;
  numerator: number | null;
  denominator: number | null;
};

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function startOfDay(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

// Baseline: the 28 days before the execution day. Follow-up: the 28 days
// ending 3 days before `now`, only once the change is at least 7 days old.
// Returns null when the execution time cannot be read.
export function planGscWindows(
  executedAt: string,
  now: Date,
): GscWindowPlan | null {
  const executedMs = Date.parse(executedAt);
  if (Number.isNaN(executedMs)) return null;
  const executedDay = startOfDay(dayOf(executedMs));
  const baselineEnd = executedDay - DAY_MS;
  const baseline = {
    start: dayOf(baselineEnd - (WINDOW_DAYS - 1) * DAY_MS),
    end: dayOf(baselineEnd),
  };
  const lagEnd = startOfDay(dayOf(now.getTime())) - GSC_LAG_DAYS * DAY_MS;
  const baselineReady = baselineEnd <= lagEnd;

  const ageDays = (now.getTime() - executedMs) / DAY_MS;
  if (ageDays < MIN_DAYS_BEFORE_FOLLOW_UP) {
    return {
      baseline,
      baselineReady,
      followUp: {
        status: "too_early",
        readyOn: dayOf(executedMs + MIN_DAYS_BEFORE_FOLLOW_UP * DAY_MS),
      },
    };
  }
  const followStart = lagEnd - (WINDOW_DAYS - 1) * DAY_MS;
  // Days of the follow-up window that precede the change. The window length is
  // fixed, so a young change is compared over a window that partly predates it;
  // the count is surfaced rather than hidden.
  const daysBeforeChange = Math.max(
    0,
    Math.min(WINDOW_DAYS, Math.round((executedDay - followStart) / DAY_MS)),
  );
  return {
    baseline,
    baselineReady,
    followUp: {
      status: "ready",
      window: { start: dayOf(followStart), end: dayOf(lagEnd) },
      daysBeforeChange,
    },
  };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return url.replace(/\/+$/, "");
  }
}

// Search Console's "contains" would pull in /post-2 when asked for /post, so
// rows are narrowed again by exact path. The path, not the host, is compared:
// a store may answer on a custom domain while the property uses another.
export function pageFilterFor(targetUrl: string): {
  filter: { operator: "contains" | "equals"; expression: string };
  keepRow: (pageUrl: string) => boolean;
} {
  const path = pathOf(targetUrl);
  if (path === "") {
    // A home page: "contains /" would match the whole site.
    return {
      filter: { operator: "equals", expression: targetUrl },
      keepRow: () => true,
    };
  }
  return {
    filter: { operator: "contains", expression: path },
    keepRow: (pageUrl) => pathOf(pageUrl) === path,
  };
}

export function aggregateGscRows(
  rows: { clicks: number; impressions: number; position: number }[],
): GscTotals | null {
  let clicks = 0;
  let impressions = 0;
  let positionTimesImpressions = 0;
  for (const row of rows) {
    clicks += row.clicks;
    impressions += row.impressions;
    positionTimesImpressions += row.position * row.impressions;
  }
  if (impressions <= 0) return null;
  return {
    clicks,
    impressions,
    ctr: clicks / impressions,
    position: positionTimesImpressions / impressions,
    positionTimesImpressions,
  };
}

// Rates keep both parts so a reader can see the sample behind the number.
export function observationsFromTotals(
  totals: GscTotals,
): GscObservationDraft[] {
  return [
    {
      metric: "clicks",
      value: totals.clicks,
      numerator: null,
      denominator: null,
    },
    {
      metric: "impressions",
      value: totals.impressions,
      numerator: null,
      denominator: null,
    },
    {
      metric: "ctr",
      value: totals.ctr,
      numerator: totals.clicks,
      denominator: totals.impressions,
    },
    {
      metric: "position",
      value: totals.position,
      numerator: totals.positionTimesImpressions,
      denominator: totals.impressions,
    },
  ];
}
