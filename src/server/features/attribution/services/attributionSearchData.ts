import { Ga4AiReferralService } from "@/server/features/ga4/services/Ga4AiReferralService";
import { GscService } from "@/server/features/gsc/services/GscService";
import { SourceIntelligenceRepository } from "@/server/features/source-intelligence/repositories/SourceIntelligenceRepository";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import type { RangeKey } from "@/shared/attribution/ranges";

// Search Console, GA4 and the AI answer store are read here, never copied into
// the attribution ledger. What they say about a page is about the page in
// general (Associated evidence), never about one visitor or one outcome.

const DAYS: Record<RangeKey, number> = {
  "7d": 7,
  "28d": 28,
  "90d": 90,
  "365d": 365,
};
// Search Console data trails by about three days.
const GSC_LAG_DAYS = 3;
const PAGE_ROWS = 1000;
const QUERY_ROWS = 1000;
const DAY_MS = 86_400_000;

type SourceStatus = "ok" | "not_connected" | "unavailable";
type Read<T> = { status: SourceStatus; data: T };

type SearchPage = {
  host: string;
  path: string;
  clicks: number;
  impressions: number;
  position: number;
};
type SearchQuery = SearchPage & { query: string };

function gscDates(range: RangeKey, now = new Date()) {
  const end = new Date(now.getTime() - GSC_LAG_DAYS * DAY_MS);
  const start = new Date(end.getTime() - (DAYS[range] - 1) * DAY_MS);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function splitUrl(value: string): { host: string; path: string } | null {
  try {
    const url = new URL(value);
    return {
      host: url.hostname.toLowerCase().replace(/^www\./, ""),
      path: url.pathname || "/",
    };
  } catch {
    return null;
  }
}

async function readGsc<T>(read: () => Promise<T>, empty: T): Promise<Read<T>> {
  try {
    return { status: "ok", data: await read() };
  } catch (error) {
    return {
      status:
        error instanceof GscNotConnectedError ? "not_connected" : "unavailable",
      data: empty,
    };
  }
}

/** Search Console clicks, impressions and position for each page. */
export function readSearchPages(projectId: string, range: RangeKey) {
  return readGsc<SearchPage[]>(async () => {
    const result = await GscService.getPerformance({
      projectId,
      dimensions: ["page"],
      ...gscDates(range),
      rowLimit: PAGE_ROWS,
    });
    return result.rows.flatMap((row) => {
      const where = splitUrl(row.keys?.[0] ?? "");
      return where
        ? [
            {
              ...where,
              clicks: row.clicks,
              impressions: row.impressions,
              position: row.position,
            },
          ]
        : [];
    });
  }, []);
}

/** The queries Search Console reports for one page. */
export function readSearchQueries(
  projectId: string,
  range: RangeKey,
  host: string,
  path: string,
) {
  return readGsc<SearchQuery[]>(async () => {
    const result = await GscService.getPerformance({
      projectId,
      dimensions: ["page", "query"],
      ...gscDates(range),
      filters: [{ dimension: "page", operator: "contains", expression: path }],
      rowLimit: QUERY_ROWS,
    });
    return result.rows.flatMap((row) => {
      const where = splitUrl(row.keys?.[0] ?? "");
      const query = row.keys?.[1];
      return where && query && where.host === host && where.path === path
        ? [
            {
              ...where,
              query,
              clicks: row.clicks,
              impressions: row.impressions,
              position: row.position,
            },
          ]
        : [];
    });
  }, []);
}

/** Visits GA4 recorded from AI assistants, for comparison with first-party sessions. */
export async function readGa4AiReferrals(projectId: string) {
  try {
    const result = await Ga4AiReferralService.getAiReferrals(projectId);
    return {
      status: "ok" as const,
      data: result.assistants.map((a) => ({
        name: a.name,
        sessions: a.sessions,
        keyEvents: a.keyEvents,
      })),
    };
  } catch {
    return {
      status: "unavailable" as const,
      data: [] as { name: string; sessions: number; keyEvents: number }[],
    };
  }
}

/** How many stored AI answers cite each URL on one of the project's own hosts. */
export async function readAiCitedPages(
  projectId: string,
  hosts: string[],
  days: 28 | 90,
) {
  const rows = (
    await Promise.all(
      hosts.map((host) =>
        SourceIntelligenceRepository.citedCounts(
          projectId,
          { days, sourceDomain: host, hideDismissed: false },
          "url",
        ),
      ),
    )
  ).flat();
  const pages = new Map<
    string,
    { host: string; path: string; answers: number; engines: Set<string> }
  >();
  for (const row of rows) {
    const where = splitUrl(row.key);
    if (!where) continue;
    const id = `${where.host}${where.path}`;
    const page = pages.get(id) ?? { ...where, answers: 0, engines: new Set() };
    page.answers += row.answers;
    page.engines.add(row.engine);
    pages.set(id, page);
  }
  return [...pages.values()].map((p) => ({
    host: p.host,
    path: p.path,
    answers: p.answers,
    engines: [...p.engines],
  }));
}
