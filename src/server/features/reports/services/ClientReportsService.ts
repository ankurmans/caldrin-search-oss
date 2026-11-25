import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { getPlatformAccess } from "@/server/features/billing/platformAccess";
import { getShareBrand } from "@/server/features/branding/branding";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { AppError } from "@/server/lib/errors";
import { REPORT_APP_LIST_LIMIT } from "@/types/schemas/reports";
import { ReportRepository } from "../repositories/ReportRepository";

export async function listClientReports(
  organizationId: string,
  allowedIds: string[],
) {
  const [access, brand, projects] = await Promise.all([
    getPlatformAccess(organizationId),
    getShareBrand(organizationId),
    ProjectRepository.listProjects(organizationId),
  ]);
  const granted = access.canInviteGuests
    ? projects
        .filter((project) => allowedIds.includes(project.id))
        .map(({ id, name }) => ({ id, name }))
    : [];
  return {
    active: access.canInviteGuests,
    brand,
    projects: granted,
    reports: await ReportRepository.listClientReports(
      granted.map(({ id }) => id),
      REPORT_APP_LIST_LIMIT,
    ),
  };
}

export async function getClientReportAccess(
  organizationId: string,
  projectId: string,
  reportId: string,
) {
  const [access, visible] = await Promise.all([
    getPlatformAccess(organizationId),
    ReportRepository.getClientVisibility(projectId, reportId),
  ]);
  return { available: access.canInviteGuests, visible };
}

export async function setClientReportAccess(
  context: {
    organizationId: string;
    userId: string;
    userEmail: string;
    projectId: string;
  },
  input: { reportId: string; updatedAt: string; visible: boolean },
) {
  if (
    input.visible &&
    !(await getPlatformAccess(context.organizationId)).canInviteGuests
  ) {
    throw new AppError("FORBIDDEN", "Client reporting requires Agency.");
  }
  const changed = await ReportRepository.setClientVisibility(
    context.projectId,
    input.reportId,
    input.visible,
    input.updatedAt,
  );
  if (!changed)
    throw new AppError(
      "CONFLICT",
      "The report changed. Reload it and review the current version.",
    );
  await AuditLogService.recordUser(
    context,
    "report.client_access_changed",
    input.visible
      ? "Published a report to client logins"
      : "Removed a report from client logins",
    {
      projectId: context.projectId,
      targetKind: "report",
      targetId: input.reportId,
    },
  );
}
