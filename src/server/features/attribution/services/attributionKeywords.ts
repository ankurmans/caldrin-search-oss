import { sort } from "remeda";
import { addMoney, type Money } from "@/shared/attribution/money";
import { AttributionLandingRepository as landing } from "../repositories/AttributionLandingRepository";
import { readSearchQueries } from "./attributionSearchData";
import { resolveScope, type ReportQuery } from "./attributionReports";

const BP = 10_000;
const MAX_QUERIES = 50;

const KEYWORD_NOTE =
  "Google does not report which search led to a visit, so these shares are estimates: the page's organic outcomes divided by each query's share of the page's clicks. They show which searches are likely to matter, not which one produced an outcome.";

/**
 * The searches that bring people to a page and the outcomes that page's organic
 * visits led to, divided across the searches by their share of clicks. Every
 * figure here is Associated evidence and is never added to the models' credit.
 */
export async function getKeywordAssociations(
  query: ReportQuery & { host: string; path: string },
) {
  const { scope, model, currency } = await resolveScope(query);
  const [credits, queries] = await Promise.all([
    landing.creditsByLandingPage(scope, model, {
      channel: "organic_search",
      host: query.host,
      path: query.path,
    }),
    readSearchQueries(query.projectId, query.range, query.host, query.path),
  ]);

  const outcomes: Record<string, number> = {};
  const revenue: Money[] = [];
  for (const c of credits) {
    outcomes[c.kind] = (outcomes[c.kind] ?? 0) + c.bp / BP;
    addMoney(revenue, c.currency, Math.round(c.weighted / BP));
  }
  const clicks = queries.data.reduce((n, q) => n + q.clicks, 0);

  const rows = queries.data.map((q) => {
    const share = clicks ? q.clicks / clicks : 0;
    const money: Money[] = revenue.map((m) => ({
      currency: m.currency,
      minor: Math.round(m.minor * share),
    }));
    return {
      query: q.query,
      clicks: q.clicks,
      impressions: q.impressions,
      position: q.position,
      share,
      outcomes: Object.fromEntries(
        Object.entries(outcomes).map(([kind, n]) => [kind, n * share]),
      ),
      revenue: money,
    };
  });

  return {
    reportingCurrency: currency,
    evidence: "associated" as const,
    note: KEYWORD_NOTE,
    searchStatus: queries.status,
    organicOutcomes: outcomes,
    organicRevenue: revenue,
    // Outcomes cannot be divided when Search Console shows no clicks for the page.
    undivided: clicks === 0 && Object.keys(outcomes).length > 0,
    queries: sort(rows, (a, b) => b.clicks - a.clicks).slice(0, MAX_QUERIES),
  };
}
