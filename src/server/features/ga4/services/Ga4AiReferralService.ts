import { sortBy } from "remeda";
import { aiAssistantFor } from "../rules/aiAssistants";
import { inclusiveGa4Days, shiftGa4Date } from "./Ga4Dates";
import { Ga4ReportingService } from "./Ga4ReportingService";

const WEEK_DAYS = 7;

const num = (value: string | number | null | undefined) =>
  typeof value === "number" ? value : 0;

type Totals = { sessions: number; engagedSessions: number; keyEvents: number };

/**
 * Visits that came from AI assistants over the default range (last 28 complete
 * days): grouped by assistant, plus the pages they landed on. Only sessions that
 * carry a referrer are found; the rest are recorded as direct traffic.
 */
async function getAiReferrals(projectId: string) {
  const [sources, landing, daily] = await Promise.all([
    Ga4ReportingService.runReport({
      projectId,
      kind: "traffic_acquisition",
      acquisitionBreakdown: "source_medium",
      channel: "ai_referrals",
      limit: 200,
    }),
    Ga4ReportingService.runReport({
      projectId,
      kind: "landing_pages",
      channel: "ai_referrals",
      limit: 25,
    }),
    Ga4ReportingService.runReport({
      projectId,
      kind: "traffic_acquisition",
      acquisitionBreakdown: "source_medium",
      includeDate: true,
      channel: "ai_referrals",
      limit: 1000,
    }),
  ]);

  const byAssistant = new Map<string, Totals>();
  for (const row of sources.rows) {
    const sourceMedium = String(row.sessionSourceMedium ?? "");
    const assistant = aiAssistantFor(sourceMedium.split(" / ")[0] ?? "");
    if (!assistant) continue;
    const totals = byAssistant.get(assistant) ?? {
      sessions: 0,
      engagedSessions: 0,
      keyEvents: 0,
    };
    totals.sessions += num(row.sessions);
    totals.engagedSessions += num(row.engagedSessions);
    totals.keyEvents += num(row.keyEvents);
    byAssistant.set(assistant, totals);
  }
  const assistants = sortBy(
    [...byAssistant].map(([name, totals]) => ({ name, ...totals })),
    [(assistant) => assistant.sessions, "desc"],
  );

  const { startDate, endDate } = sources.request.resolvedDateRange;
  const weekCount = Math.floor(
    inclusiveGa4Days(startDate, endDate) / WEEK_DAYS,
  );
  // Weeks end on the last day of the range, so the newest one is always whole.
  const weeks = Array.from({ length: weekCount }, (_, index) => {
    const weekEnd = shiftGa4Date(endDate, -(weekCount - 1 - index) * WEEK_DAYS);
    return {
      start: shiftGa4Date(weekEnd, -(WEEK_DAYS - 1)),
      end: weekEnd,
      sessions: 0,
    };
  });
  for (const row of daily.rows) {
    const raw = String(row.date ?? "");
    const day = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const week = weeks.find((w) => day >= w.start && day <= w.end);
    const sourceMedium = String(row.sessionSourceMedium ?? "");
    if (week && aiAssistantFor(sourceMedium.split(" / ")[0] ?? "")) {
      week.sessions += num(row.sessions);
    }
  }

  return {
    dateRange: sources.request.resolvedDateRange,
    weeks,
    totalSessions: assistants.reduce((sum, a) => sum + a.sessions, 0),
    assistants,
    pages: landing.rows.map((row) => ({
      host: String(row.hostName ?? ""),
      path: String(row.landingPage ?? ""),
      sessions: num(row.sessions),
      keyEvents: num(row.keyEvents),
    })),
    warnings: [...sources.warnings, ...landing.warnings, ...daily.warnings],
  };
}

export const Ga4AiReferralService = { getAiReferrals };
