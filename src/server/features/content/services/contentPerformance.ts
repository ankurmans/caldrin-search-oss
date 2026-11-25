import {
  GscNotConnectedError,
  GscService,
} from "@/server/features/gsc/services/GscService";
import { ContentRepository } from "../repositories/ContentRepository";
import { assessPerformance, type Window } from "../rules/performanceRules";

const WINDOW_DAYS = 28;
const GSC_LAG_DAYS = 3;

function isoDay(offsetDays: number, now: Date): string {
  return new Date(now.getTime() - offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// The path, not the host: the live store may answer on a custom domain while
// the Search Console property is recorded under another.
function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
}

async function readWindow(
  projectId: string,
  path: string,
  startDate: string,
  endDate: string,
): Promise<Window | null> {
  const result = await GscService.getPerformance({
    projectId,
    dimensions: ["page"],
    startDate,
    endDate,
    filters: [{ dimension: "page", operator: "contains", expression: path }],
    rowLimit: 200,
  });
  // "contains" also returns longer paths that start the same way, such as
  // /blogs/news/tips-2 for /blogs/news/tips, so only this page is counted.
  const rows = result.rows.filter((row) => {
    const page = row.keys?.[0];
    return page !== undefined && pathOf(page) === path;
  });
  if (rows.length === 0) return null;
  let clicks = 0;
  let impressions = 0;
  let positionWeighted = 0;
  for (const row of rows) {
    clicks += row.clicks;
    impressions += row.impressions;
    positionWeighted += row.position * row.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? positionWeighted / impressions : 0,
  };
}

export type ArticlePerformance = {
  assetId: string;
  title: string;
  revision: number;
  url: string | null;
  publishedAt: string | null;
  query: string | null;
  source: "gsc" | "demo" | "unavailable";
  note: string | null;
  window: { startDate: string; endDate: string };
  current: Window | null;
  previous: Window | null;
  status: "too_early" | "no_data" | "measured";
  suggestions: ReturnType<typeof assessPerformance>["suggestions"];
};

export async function getContentPerformance(
  projectId: string,
): Promise<{ gscConnected: boolean; articles: ArticlePerformance[] }> {
  const now = new Date();
  const articles = await ContentRepository.listPublishedArticles(projectId);
  const end = isoDay(GSC_LAG_DAYS, now);
  const start = isoDay(GSC_LAG_DAYS + WINDOW_DAYS - 1, now);
  const prevEnd = isoDay(GSC_LAG_DAYS + WINDOW_DAYS, now);
  const prevStart = isoDay(GSC_LAG_DAYS + 2 * WINDOW_DAYS - 1, now);

  let gscConnected = true;
  const out: ArticlePerformance[] = [];
  for (const a of articles) {
    const base = {
      assetId: a.assetId,
      title: a.title,
      revision: a.revision,
      url: a.url,
      publishedAt: a.publishedAt,
      query: a.query,
      window: { startDate: start, endDate: end },
    };
    // A simulated store's pages do not exist on the internet, so there is
    // nothing to measure and no number is invented.
    if (a.mode === "simulated" || !a.url) {
      out.push({
        ...base,
        source: "demo",
        note: "Demo article: it was never published to a real store, so there is no search data.",
        current: null,
        previous: null,
        status: "no_data",
        suggestions: [],
      });
      continue;
    }
    let current: Window | null = null;
    let previous: Window | null = null;
    let note: string | null = null;
    let source: "gsc" | "unavailable" = "gsc";
    if (gscConnected) {
      try {
        current = await readWindow(projectId, pathOf(a.url), start, end);
        previous = await readWindow(
          projectId,
          pathOf(a.url),
          prevStart,
          prevEnd,
        );
      } catch (error) {
        if (error instanceof GscNotConnectedError) gscConnected = false;
        else note = "Search Console could not be read for this article.";
        source = "unavailable";
      }
    }
    if (!gscConnected) {
      source = "unavailable";
      note = "Connect Search Console for this project to see results.";
    }
    const assessed = assessPerformance({
      publishedAt: a.publishedAt,
      now,
      current,
      previous,
    });
    out.push({
      ...base,
      source,
      note,
      current,
      previous,
      status: source === "unavailable" ? "no_data" : assessed.status,
      suggestions: source === "unavailable" ? [] : assessed.suggestions,
    });
  }
  return { gscConnected, articles: out };
}
