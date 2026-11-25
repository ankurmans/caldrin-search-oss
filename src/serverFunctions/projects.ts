import { waitUntil } from "cloudflare:workers";
import { captureServerEvent } from "@/server/lib/posthog";
import { ProjectSitePlatformService } from "@/server/features/projects/services/ProjectSitePlatformService";
import { SITE_PLATFORMS } from "@/shared/site-platform";
import { AppError } from "@/server/lib/errors";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { DashboardFirstAuditService } from "@/server/features/dashboard/services/DashboardFirstAuditService";
import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { ProjectService } from "@/server/features/projects/services/ProjectService";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";
import {
  archiveProjectSchema,
  createProjectSchema,
  archivedProjectSchema,
  organizeProjectsSchema,
  updateProjectSchema,
} from "@/types/schemas/projects";
import { z } from "zod";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });

export const getProjects = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    const all = await ProjectService.listProjectsEnsuringOne(
      context.organizationId,
    );
    const allowed = context.allowedProjectIds;
    return allowed ? all.filter((p) => allowed.includes(p.id)) : all;
  });

// Star / group / reorder, saved for the whole workspace in one call.
export const organizeProjects = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(organizeProjectsSchema)
  .handler(async ({ data, context }) => {
    // The layout is shared by the whole workspace.
    if (context.allowedProjectIds) throw new AppError("FORBIDDEN");
    await ProjectService.organizeProjects(context.organizationId, data);
    return { ok: true as const };
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(createProjectSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { project: ["create"] });
    const project = await ProjectService.createProject(
      context.organizationId,
      data,
    );
    await AuditLogService.recordUser(
      context,
      "project.created",
      `Created project ${project.domain ?? project.name}`,
      { projectId: project.id, targetKind: "project", targetId: project.id },
    );
    const initialAudit = await DashboardFirstAuditService.start(
      project.id,
      project.domain,
      { ...context, projectId: project.id },
    );
    if (project.domain) {
      waitUntil(
        captureServerEvent({
          distinctId: context.userId,
          organizationId: context.organizationId,
          event: "onboarding:site_added",
          properties: { project_id: project.id },
        }),
      );
    }
    return { ...project, initialAudit };
  });

export const updateProject = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateProjectSchema)
  .handler(async ({ data, context }) => {
    const project = await ProjectService.updateProject(
      context.organizationId,
      data,
    );
    const initialAudit =
      project.domain !== context.project.domain
        ? await DashboardFirstAuditService.start(
            project.id,
            project.domain,
            context,
          )
        : null;
    if (project.domain && !context.project.domain) {
      waitUntil(
        captureServerEvent({
          distinctId: context.userId,
          organizationId: context.organizationId,
          event: "onboarding:site_added",
          properties: { project_id: project.id },
        }),
      );
    }
    return { ...project, initialAudit };
  });

export const archiveProject = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(archiveProjectSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { project: ["delete"] });
    const result = await ProjectService.archiveProject(
      context.organizationId,
      data,
    );
    await AuditLogService.recordUser(
      context,
      "project.archived",
      `Archived project ${context.project.domain ?? context.project.name}`,
      {
        projectId: context.projectId,
        targetKind: "project",
        targetId: context.projectId,
      },
    );
    return result;
  });

export const getArchivedProjects = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    const all = await ProjectService.listArchivedProjects(
      context.organizationId,
    );
    const allowed = context.allowedProjectIds;
    return allowed ? all.filter((p) => allowed.includes(p.id)) : all;
  });

export const restoreProject = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(archivedProjectSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { project: ["delete"] });
    const result = await ProjectService.restoreProject(
      context.organizationId,
      data,
    );
    await AuditLogService.recordUser(
      context,
      "project.restored",
      "Restored an archived project",
      {
        projectId: data.archivedProjectId,
        targetKind: "project",
        targetId: data.archivedProjectId,
      },
    );
    return result;
  });

export const deleteArchivedProject = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(archivedProjectSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { project: ["delete"] });
    const result = await ProjectService.deleteArchivedProject(
      context.organizationId,
      data,
    );
    await AuditLogService.recordUser(
      context,
      "project.deleted",
      "Permanently deleted an archived project",
      { targetKind: "project", targetId: data.archivedProjectId },
    );
    return result;
  });

export const getProjectAccess = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(projectScopedSchema)
  .handler(async ({ data, context }) => {
    return ProjectService.getProjectForOrganization(
      context.organizationId,
      data.projectId,
    );
  });

export const getProjectSitePlatform = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema.extend({ refresh: z.boolean().optional() }))
  .handler(({ data, context }) => {
    const { project } = context;
    if (project.domain && (data.refresh || !project.detectedPlatform))
      return ProjectSitePlatformService.detect(project);

    return {
      siteHost: project.siteHost,
      detectedPlatform: project.detectedPlatform,
      platformEvidence: project.platformEvidence,
      platformOverride: project.platformOverride,
    };
  });

export const setProjectSitePlatform = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScopedSchema.extend({
      domain: z.string().min(1).max(255),
      platform: z.enum(SITE_PLATFORMS).nullable(),
    }),
  )
  .handler(({ data, context }) =>
    ProjectSitePlatformService.setOverride(
      context.project,
      data.domain,
      data.platform,
    ),
  );
