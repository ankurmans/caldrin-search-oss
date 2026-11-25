import { sort } from "remeda";
import { addMoney, type Money } from "@/shared/attribution/money";
import { AttributionLandingRepository as landing } from "../repositories/AttributionLandingRepository";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { AttributionReportRepository as reports } from "../repositories/AttributionReportRepository";
import { resolveScope, type ReportQuery } from "./attributionReports";
import { readAiCitedPages, readGa4AiReferrals } from "./attributionSearchData";

const BP = 10_000;
const AI = "ai_referral";
const MAX_PAGES = 25;

const AI_REFERRAL_NOTE =
  "A visit counts as AI-referred only when the assistant sent a referrer or tagged the link. Many assistants send neither, so those visits arrive as direct traffic and appear here only if the buyer said so.";

type Assistant = {
  name: string;
  sessions: number;
  visitors: number;
  credited: Record<string, number>;
  revenue: Money[];
  /** Buyers who named this assistant in their own words. */
  selfReported: number;
};

/**
 * Visits and outcomes that came from AI assistants, from first-party events,
 * with three clearly separate additions: buyers' own words (Self-reported),
 * how often AI answers cite each page (Associated) and GA4's own count of the
 * same visits (a cross-check, not a source of credit).
 */
export async function getAiReferralIntelligence(query: ReportQuery) {
  const { scope, model, currency } = await resolveScope(query);
  const days = query.range === "7d" || query.range === "28d" ? 28 : 90;

  const [properties, allSessions] = await Promise.all([
    ledger.listProperties(query.projectId),
    landing.sessionsByLandingPage(scope),
  ]);
  // Registered sites, plus any host a recorded session landed on.
  const hosts = [
    ...new Set([
      ...properties.map((p) => p.host),
      ...allSessions.map((s) => s.host),
    ]),
  ];
  const sessions = allSessions.filter((s) => s.channel === AI);

  const [bySource, pageCredits, selfReported, cited, ga4] = await Promise.all([
    reports.creditRollup(scope, { model, bySource: true }),
    landing.creditsByLandingPage(scope, model, { channel: AI }),
    landing.selfReportedBySource(scope, AI),
    readAiCitedPages(query.projectId, hosts, days),
    readGa4AiReferrals(query.projectId),
  ]);

  const assistants = new Map<string, Assistant>();
  const assistantFor = (name: string | null) => {
    const key = name ?? "An AI assistant";
    let row = assistants.get(key);
    if (!row) {
      row = {
        name: key,
        sessions: 0,
        visitors: 0,
        credited: {},
        revenue: [],
        selfReported: 0,
      };
      assistants.set(key, row);
    }
    return row;
  };
  for (const s of sessions) {
    const row = assistantFor(s.source);
    row.sessions += s.sessions;
    row.visitors += s.visitors;
  }
  for (const credit of bySource.filter((c) => c.channel === AI)) {
    const row = assistantFor(credit.source);
    row.credited[credit.kind] =
      (row.credited[credit.kind] ?? 0) + credit.bp / BP;
    addMoney(row.revenue, credit.currency, Math.round(credit.weighted / BP));
  }
  for (const s of selfReported) assistantFor(s.source).selfReported += s.count;

  type PageRow = {
    host: string;
    path: string;
    sessions: number;
    credited: Record<string, number>;
    revenue: Money[];
    /** Stored AI answers that cite this page. Associated: about the page, not the visit. */
    citedAnswers: number;
    citedEngines: string[];
  };
  const pages = new Map<string, PageRow>();
  const pageFor = (host: string, path: string) => {
    const id = `${host}${path}`;
    let row = pages.get(id);
    if (!row) {
      row = {
        host,
        path,
        sessions: 0,
        credited: {},
        revenue: [],
        citedAnswers: 0,
        citedEngines: [],
      };
      pages.set(id, row);
    }
    return row;
  };
  for (const s of sessions) pageFor(s.host, s.path).sessions += s.sessions;
  for (const c of pageCredits) {
    const row = pageFor(c.host, c.path);
    row.credited[c.kind] = (row.credited[c.kind] ?? 0) + c.bp / BP;
    addMoney(row.revenue, c.currency, Math.round(c.weighted / BP));
  }
  for (const c of cited) {
    const row = pageFor(c.host, c.path);
    row.citedAnswers = c.answers;
    row.citedEngines = c.engines;
  }

  const ranked = sort(
    [...pages.values()],
    (a, b) => b.sessions - a.sessions || b.citedAnswers - a.citedAnswers,
  );
  const firstParty = new Map(
    [...assistants.values()].map((a) => [a.name, a.sessions]),
  );
  return {
    model,
    reportingCurrency: currency,
    note: AI_REFERRAL_NOTE,
    assistants: sort(
      [...assistants.values()],
      (a, b) => b.sessions - a.sessions || b.selfReported - a.selfReported,
    ),
    pages: ranked.slice(0, MAX_PAGES),
    citedWithoutVisits: ranked
      .filter((p) => p.citedAnswers > 0 && p.sessions === 0)
      .slice(0, MAX_PAGES),
    ga4: {
      status: ga4.status,
      // GA4's reading always covers its last 28 complete days.
      comparable: query.range === "28d",
      assistants: ga4.data.map((a) => ({
        ...a,
        firstPartySessions: firstParty.get(a.name) ?? 0,
      })),
    },
  };
}
