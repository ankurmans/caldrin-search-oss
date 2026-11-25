import { sort } from "remeda";
import { addMoney, type Money } from "@/shared/attribution/money";
import {
  EVIDENCE_LEVELS,
  narrow,
  type Evidence,
} from "@/shared/attribution/vocabulary";
import { AttributionLandingRepository as landing } from "../repositories/AttributionLandingRepository";
import { readSearchPages } from "./attributionSearchData";
import { resolveScope, type ReportQuery } from "./attributionReports";

const BP = 10_000;
const MAX_PAGES = 100;

/** Outcomes that mean a buyer took a commercial step, not just a visit. */
const COMMERCIAL_KINDS = new Set([
  "lead",
  "qualified_lead",
  "call",
  "booking",
  "deal_won",
  "payment",
]);

export type LandingRow = {
  host: string;
  path: string;
  sessions: number;
  visitors: number;
  /** Sessions by the channel each one arrived through. */
  channels: Record<string, number>;
  /** Outcomes credited to sessions that landed here, by kind, as fractions. */
  credited: Record<string, number>;
  revenue: Money[];
  /** Share of this page's credit at each evidence level, in basis points. */
  evidenceBp: Record<Evidence, number>;
  commercial: boolean;
  /** Search Console's reading of the page. Associated: about the page, not the visitors. */
  search: { clicks: number; impressions: number; position: number } | null;
};

const revenueTotal = (row: LandingRow) =>
  row.revenue.reduce((n, m) => n + m.minor, 0);

const emptyEvidence = (): Record<Evidence, number> => ({
  observed: 0,
  linked: 0,
  self_reported: 0,
  associated: 0,
  modelled: 0,
  unknown: 0,
});

/**
 * Landing pages with what their sessions led to, from first-party events, and
 * (when a property is connected) what Search Console says about the page.
 * The first-party columns are Observed or Linked; the Search Console columns
 * are Associated, and a missing connection leaves them empty rather than zero.
 */
export async function getLandingPages(
  query: ReportQuery & { onlyCommercial?: boolean },
) {
  const { scope, model, currency } = await resolveScope(query);
  const [credits, sessions, search] = await Promise.all([
    landing.creditsByLandingPage(scope, model),
    landing.sessionsByLandingPage(scope),
    readSearchPages(query.projectId, query.range),
  ]);

  const pages = new Map<string, LandingRow>();
  const rowFor = (host: string, path: string) => {
    const id = `${host}${path}`;
    let row = pages.get(id);
    if (!row) {
      row = {
        host,
        path,
        sessions: 0,
        visitors: 0,
        channels: {},
        credited: {},
        revenue: [],
        evidenceBp: emptyEvidence(),
        commercial: false,
        search: null,
      };
      pages.set(id, row);
    }
    return row;
  };

  for (const s of sessions) {
    const row = rowFor(s.host, s.path);
    row.sessions += s.sessions;
    // A visitor can arrive through two channels; the page total is the larger count.
    row.visitors = Math.max(row.visitors, s.visitors);
    row.channels[s.channel] = (row.channels[s.channel] ?? 0) + s.sessions;
  }
  for (const c of credits) {
    const row = rowFor(c.host, c.path);
    row.credited[c.kind] = (row.credited[c.kind] ?? 0) + c.bp / BP;
    addMoney(row.revenue, c.currency, Math.round(c.weighted / BP));
    row.evidenceBp[narrow(EVIDENCE_LEVELS, c.evidence) ?? "unknown"] += c.bp;
    if (COMMERCIAL_KINDS.has(c.kind)) row.commercial = true;
  }
  for (const s of search.data) {
    const row = pages.get(`${s.host}${s.path}`);
    if (row)
      row.search = {
        clicks: s.clicks,
        impressions: s.impressions,
        position: s.position,
      };
  }

  const all = [...pages.values()].filter(
    (row) => !query.onlyCommercial || row.commercial,
  );
  const ranked = sort(
    all,
    (a, b) =>
      revenueTotal(b) - revenueTotal(a) ||
      Object.values(b.credited).reduce((n, v) => n + v, 0) -
        Object.values(a.credited).reduce((n, v) => n + v, 0) ||
      b.sessions - a.sessions,
  );
  return {
    model,
    reportingCurrency: currency,
    pages: ranked.slice(0, MAX_PAGES),
    truncated: Math.max(0, ranked.length - MAX_PAGES),
    searchStatus: search.status,
  };
}
