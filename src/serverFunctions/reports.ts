import {
  getReportMarkets,
  getMarketComparison,
  saveMarketComparison,
} from "@/server/features/reports/services/MarketReportService";
import {
  getMarketReportDelivery,
  scheduleMarketReport,
  stopMarketReportDelivery,
} from "@/server/features/reports/services/marketReportDelivery";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { createServerFn } from "@tanstack/react-start";
import { omit } from "remeda";
import { z } from "zod";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { ReportService } from "@/server/features/reports/services/ReportService";
import { ReportTemplateService } from "@/server/features/reports/services/ReportTemplateService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  REPORT_APP_LIST_LIMIT,
  REPORT_DEFAULT_LIST_LIMIT,
  type ReportMetadata,
} from "@/types/schemas/reports";

// Reports read path for the app. The `projectId` field in each validator is
// what triggers project authorization (ADR 0001); the service never authorizes.
// The stored `html` is deliberately unreachable from here — the /r/<id> render
// route is its only reader, so no server function can pull documents into the
// app worker's heap.

const listReportsSchema = z.object({
  projectId: z.string().min(1),
  limit: z.number().int().min(1).max(REPORT_APP_LIST_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
});

const reportRefSchema = z.object({
  projectId: z.string().min(1),
  reportId: z.string().min(1),
});

/**
 * `summary` is dropped on the way out: it is written for agents, the app never
 * renders it, and it is the one field here big enough to matter on the wire.
 * MCP and the share page still read it.
 */
export type ReportListItem = Omit<ReportMetadata, "summary"> & {
  /**
   * Display name behind `createdByUserId`, or null when the user is gone
   * (GDPR re-attribution) or has no name. The UI falls back to the client
   * label alone.
   */
  createdByName: string | null;
  /** The template's name, or null when the report followed none or its id no longer resolves in this project. */
  templateName: string | null;
};

// One lookup for all savers and one for all templates, not one per row. The
// project's whole template list is the name lookup: it is capped at ten rows.
async function withDisplayNames(
  reports: ReportMetadata[],
  projectId: string,
): Promise<ReportListItem[]> {
  const userIds = [...new Set(reports.map((report) => report.createdByUserId))];
  const [users, { templates }] = await Promise.all([
    AuthRepository.getUserNames(userIds),
    ReportTemplateService.listReportTemplates(projectId),
  ]);
  const names = new Map(users.map((user) => [user.id, user.name]));
  const templateNames = new Map(templates.map((t) => [t.id, t.name]));
  return reports.map((report) => ({
    ...omit(report, ["summary"]),
    createdByName: names.get(report.createdByUserId) ?? null,
    templateName: report.templateId
      ? (templateNames.get(report.templateId) ?? null)
      : null,
  }));
}

export const listReports = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listReportsSchema)
  .handler(async ({ data, context }) => {
    const result = await ReportService.listReports({
      projectId: context.projectId,
      limit: data.limit ?? REPORT_DEFAULT_LIST_LIMIT,
      offset: data.offset ?? 0,
    });
    // Neither `remaining` nor `totalCount` is returned: the page shows the
    // most recent REPORT_APP_LIST_LIMIT reports and says so when it is full,
    // and the caps are runaway guards nobody needs a running tally against.
    return {
      reports: await withDisplayNames(result.reports, context.projectId),
    };
  });

/** Metadata only. The document itself is served by /r/<reportId>. */
export const getReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(reportRefSchema)
  .handler(async ({ data, context }) => {
    const report = await ReportService.getReport(
      context.projectId,
      data.reportId,
    );
    const [withNames] = await withDisplayNames([report], context.projectId);
    return withNames;
  });

/**
 * Mints (or returns) the report's public link. The token alone comes back —
 * the app builds `<origin>/s/<token>` client-side, so the same server works on
 * hosted and self-hosted domains without knowing either.
 */
export const shareReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(reportRefSchema)
  .handler(async ({ data, context }) => {
    const report = await ReportService.shareReport({
      projectId: context.projectId,
      reportId: data.reportId,
      userId: context.userId,
      organizationId: context.organizationId,
    });
    return { shareToken: report.shareToken, sharedAt: report.sharedAt };
  });

export const unshareReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(reportRefSchema)
  .handler(async ({ data, context }) => {
    const report = await ReportService.unshareReport({
      projectId: context.projectId,
      reportId: data.reportId,
      userId: context.userId,
      organizationId: context.organizationId,
    });
    return { shareToken: report.shareToken, sharedAt: report.sharedAt };
  });

export const deleteReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(reportRefSchema)
  .handler(async ({ data, context }) => {
    await ReportService.deleteReport(context.projectId, data.reportId);
    return { reportId: data.reportId };
  });

const marketReportSchema = listReportsSchema.pick({ projectId: true }).extend({
  markets: z
    .array(
      z.object({
        locationCode: z.number().int().positive(),
        languageCode: z.string().min(2).max(12),
      }),
    )
    .min(2)
    .max(4),
  days: z.union([z.literal(7), z.literal(28), z.literal(90)]),
});

export const listMarketReportMarkets = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listReportsSchema.pick({ projectId: true }))
  .handler(({ context }) => getReportMarkets(context.projectId));

export const previewMarketReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(marketReportSchema)
  .handler(({ context, data }) =>
    getMarketComparison({ ...data, projectId: context.projectId }),
  );

export const createMarketReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(marketReportSchema)
  .handler(({ context, data }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return saveMarketComparison(
      { ...data, projectId: context.projectId },
      context,
    );
  });

export const getMarketDelivery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listReportsSchema.pick({ projectId: true }))
  .handler(({ context }) =>
    getMarketReportDelivery(context.projectId, context.userId),
  );

export const setMarketDelivery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    marketReportSchema.extend({
      cadence: z.union([z.literal(7), z.literal(28)]),
    }),
  )
  .handler(({ context, data }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return scheduleMarketReport({
      ...data,
      projectId: context.projectId,
      userId: context.userId,
      emailVerified: context.emailVerified,
    });
  });

export const stopMarketDelivery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listReportsSchema.pick({ projectId: true }))
  .handler(async ({ context }) => {
    await stopMarketReportDelivery(context.projectId, context.userId);
  });
