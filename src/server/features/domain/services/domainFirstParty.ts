import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { normaliseDomain } from "@/server/features/site-explorer/rules/gapMerge";
import {
  GscNotConnectedError,
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import {
  resolveDateRange,
  type GscPerformanceFilter,
} from "@/server/features/gsc/searchAnalytics";
import {
  previousPeriod,
  sumSearchTotals,
  toDimensionRows,
} from "@/server/features/gsc/searchPerformanceReport";
import { Ga4OrganicOverviewService } from "@/server/features/ga4/services/Ga4OrganicOverviewService";
import { Ga4ReportingService } from "@/server/features/ga4/services/Ga4ReportingService";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { getAuditStatusClassCounts } from "@/server/features/audit/repositories/auditResultsQueries";
import { AuditResultsService } from "@/server/features/audit/services/AuditResultsService";
import { AiVisibilityService } from "@/server/features/ai-visibility/services/AiVisibilityService";
import { Ga4ReportError } from "@/server/lib/ga4Errors";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";

const TREND_DAYS = 28;
const TOP_ROWS = 8;

type Row = Record<string, string | number | null>;

function numberOrNull(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "number" ? value : null;
}

/** First-party figures exist only for the project's own domain. */
async function isProjectDomain(projectId: string, domain: string) {
  const project = await OpportunityRepository.getProjectBrand(projectId);
  const host = parseResearchTargetOrThrow(domain).hostname;
  return project?.domain != null && normaliseDomain(project.domain) === host;
}

/** Cheap check the page uses to decide whether to show the first-party strip. */
async function ownsDomain(input: { projectId: string; domain: string }) {
  return { owned: await isProjectDomain(input.projectId, input.domain) };
}

const NOT_OWN_DOMAIN = { status: "not_own_domain" as const };
const NOT_CONNECTED = { status: "not_connected" as const };

async function getSearchConsole(input: { projectId: string; domain: string }) {
  if (!(await isProjectDomain(input.projectId, input.domain))) {
    return NOT_OWN_DOMAIN;
  }
  const project = await OpportunityRepository.getProjectBrand(input.projectId);
  const brand = project?.brandName?.trim().toLowerCase() || null;
  const { startDate, endDate } = resolveDateRange({
    dateRange: "last_28_days",
  });
  const previous = previousPeriod(startDate, endDate);
  const query = (extra: {
    startDate?: string;
    endDate?: string;
    dimensions: ("date" | "page")[];
    filters?: GscPerformanceFilter[];
    rowLimit: number;
  }) =>
    GscService.getPerformance({
      projectId: input.projectId,
      startDate,
      endDate,
      type: "web",
      ...extra,
    });
  const brandFilter = (operator: "contains" | "notContains") =>
    brand
      ? [{ dimension: "query" as const, operator, expression: brand }]
      : undefined;

  try {
    const [current, before, branded, nonBranded, pages] = await Promise.all([
      query({ dimensions: ["date"], rowLimit: 200 }),
      query({ ...previous, dimensions: ["date"], rowLimit: 200 }),
      brand
        ? query({
            dimensions: ["date"],
            filters: brandFilter("contains"),
            rowLimit: 200,
          })
        : null,
      brand
        ? query({
            dimensions: ["date"],
            filters: brandFilter("notContains"),
            rowLimit: 200,
          })
        : null,
      query({ dimensions: ["page"], rowLimit: TOP_ROWS }),
    ]);
    return {
      status: "ok" as const,
      siteUrl: current.siteUrl,
      startDate,
      endDate,
      totals: sumSearchTotals(current.rows),
      previousTotals: sumSearchTotals(before.rows),
      brandTerm: brand,
      branded: branded ? sumSearchTotals(branded.rows) : null,
      nonBranded: nonBranded ? sumSearchTotals(nonBranded.rows) : null,
      topPages: toDimensionRows(pages.rows),
    };
  } catch (error) {
    if (error instanceof GscNotConnectedError || isExpectedGrantFailure(error))
      return NOT_CONNECTED;
    throw error;
  }
}

function isExpectedGa4Failure(error: unknown) {
  return (
    error instanceof Ga4ReportError &&
    (error.code === "ga4_not_connected" ||
      error.code === "ga4_reconnect_required" ||
      error.code === "ga4_property_inaccessible")
  );
}

async function getAnalytics(input: { projectId: string; domain: string }) {
  if (!(await isProjectDomain(input.projectId, input.domain))) {
    return NOT_OWN_DOMAIN;
  }
  try {
    const [overview, landing] = await Promise.all([
      Ga4OrganicOverviewService.getOrganicOverview({
        projectId: input.projectId,
      }),
      Ga4ReportingService.runReport({
        projectId: input.projectId,
        kind: "landing_pages",
        channel: "organic_search",
        limit: TOP_ROWS,
      }),
    ]);
    const metric = (key: string) => ({
      current: numberOrNull(overview.current, key),
      previous: numberOrNull(overview.previous, key),
    });
    return {
      status: "ok" as const,
      propertyName: overview.source.propertyDisplayName,
      startDate: overview.request.resolvedDateRange.startDate,
      endDate: overview.request.resolvedDateRange.endDate,
      sessions: metric("sessions"),
      activeUsers: metric("activeUsers"),
      engagementRate: metric("engagementRate"),
      keyEvents: metric("keyEvents"),
      landingPages: landing.rows.map((row) => ({
        host: typeof row.hostName === "string" ? row.hostName : null,
        path: typeof row.landingPage === "string" ? row.landingPage : "",
        sessions: numberOrNull(row, "sessions") ?? 0,
        engagementRate: numberOrNull(row, "engagementRate"),
        keyEvents: numberOrNull(row, "keyEvents"),
      })),
    };
  } catch (error) {
    if (isExpectedGa4Failure(error)) return NOT_CONNECTED;
    throw error;
  }
}

async function getAuditHealth(input: { projectId: string; domain: string }) {
  if (!(await isProjectDomain(input.projectId, input.domain))) {
    return NOT_OWN_DOMAIN;
  }
  const audits = await AuditRepository.getAuditsByProject(input.projectId);
  const latest = audits.find((audit) => audit.status === "completed");
  if (!latest) return { status: "no_audit" as const };
  const [summary, statusCounts] = await Promise.all([
    AuditResultsService.getSummary(latest.id, input.projectId),
    getAuditStatusClassCounts(latest.id),
  ]);
  return {
    status: "ok" as const,
    auditId: latest.id,
    startUrl: latest.startUrl,
    completedAt: latest.completedAt,
    pageCount: summary.pageCount,
    issueCount: summary.issueCount,
    statusCounts,
  };
}

async function getAiVisibility(input: { projectId: string; domain: string }) {
  if (!(await isProjectDomain(input.projectId, input.domain))) {
    return NOT_OWN_DOMAIN;
  }
  const trend = await AiVisibilityService.getTrend({
    projectId: input.projectId,
    days: TREND_DAYS,
  });
  if (trend.current.coverage.runs === 0) {
    return { status: "no_runs" as const };
  }
  return {
    status: "ok" as const,
    days: trend.days,
    runs: trend.current.coverage.runs,
    answered: trend.current.coverage.answered,
    mentionRate: trend.mentions.current,
    citationRate: trend.citations.current,
    comparison: trend.comparison,
    mentionChange: trend.mentions.change,
  };
}

export const DomainFirstPartyService = {
  ownsDomain,
  getSearchConsole,
  getAnalytics,
  getAuditHealth,
  getAiVisibility,
};
