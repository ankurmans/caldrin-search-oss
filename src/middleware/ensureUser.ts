import { waitUntil } from "cloudflare:workers";
import { recordProductActivity } from "@/server/lib/productActivity";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import type { EnsuredProject } from "@/middleware/ensure-user/types";
import { canAccessProject, isClientGuest } from "@/lib/org-permissions";
import { runInWorkspace } from "@/server/lib/workspace-scope";
import { AppError, asAppError } from "@/server/lib/errors";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";

// Client accounts have a dedicated reports view. New app actions are private
// by default, regardless of their request method or whether they take a project.
const clientGuestActions = new Set([
  "getOrganizationContext",
  "switchOrganization",
  "getClientReports",
]);

function extractProjectId(data: unknown) {
  if (!data || typeof data !== "object" || !("projectId" in data)) {
    return null;
  }

  const projectId = (data as { projectId?: unknown }).projectId;
  return typeof projectId === "string" && projectId.length > 0
    ? projectId
    : null;
}

export const ensureUserMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next, data, serverFnMeta }) => {
  const context = await resolveUserContextFromHeaders(getRequest().headers);

  const startedAt = performance.now();
  const projectId = extractProjectId(data);

  let project: EnsuredProject | undefined;

  const record = (
    outcome: "success" | "refused" | "failed",
    error?: unknown,
  ) => {
    waitUntil(
      recordProductActivity({
        source: "app",
        action: serverFnMeta.name,
        userId: context.userId,
        organizationId: context.organizationId,
        projectId: project?.id,
        outcome,
        durationMs: Math.round(performance.now() - startedAt),
        errorCode: asAppError(error)?.code,
      }),
    );
  };

  try {
    if (
      isClientGuest(context.role) &&
      !clientGuestActions.has(serverFnMeta.name)
    ) {
      throw new AppError(
        "FORBIDDEN",
        "Client access is limited to published reports.",
      );
    }
    if (projectId) {
      if (!canAccessProject(context.allowedProjectIds, projectId)) {
        throw new AppError("NOT_FOUND");
      }
      // ADR 0001 intentionally keeps project authorization here so every
      // project-scoped server function gets the same request-scoped org+project
      // check before handlers run. Function-level middleware narrows the type.
      project = await ProjectRepository.getProjectForOrganization(
        projectId,
        context.organizationId,
      );

      if (!project) {
        throw new AppError("NOT_FOUND");
      }
    }

    const result = await runInWorkspace(context.organizationId, () =>
      next({
        context: {
          ...context,
          project,
        },
      }),
    );
    const returned: unknown = Reflect.get(result, "result");
    const resultWasRefused =
      returned !== null &&
      typeof returned === "object" &&
      Reflect.get(returned, "ok") === false;
    record(resultWasRefused ? "refused" : "success");
    return result;
  } catch (error) {
    const code = asAppError(error)?.code;
    record(
      code === "FORBIDDEN" ||
        code === "NOT_FOUND" ||
        code === "VALIDATION_ERROR"
        ? "refused"
        : "failed",
      error,
    );
    throw error;
  }
});
