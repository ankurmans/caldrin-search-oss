import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { getAllowedProjectIds } from "@/server/auth/project-access";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { AppError } from "@/server/lib/errors";
import { hasOrgPermission } from "@/lib/org-permissions";
import { getPlatformAccess } from "@/server/features/billing/platformAccess";
import { InvitationRequestRepository as repo } from "./InvitationRequestRepository";
import { issueTeamInvitation } from "./issueTeamInvitation";

type Actor = {
  userId: string;
  userEmail: string;
  organizationId: string;
  role: string;
};

function list(actor: Actor) {
  return repo.list(
    actor.organizationId,
    hasOrgPermission(actor.role, { invitation: ["create"] })
      ? undefined
      : actor.userId,
  );
}

async function request(actor: Actor, projectId: string, email: string) {
  const { organizationId, userId } = actor;
  const [project, allowed] = await Promise.all([
    ProjectRepository.getProjectForOrganization(projectId, organizationId),
    getAllowedProjectIds(userId, organizationId, actor.role),
  ]);
  if (!project || (allowed && !allowed.includes(projectId)))
    throw new AppError("NOT_FOUND");

  if (!(await getPlatformAccess(organizationId)).canInvite)
    throw new AppError(
      "FORBIDDEN",
      "Inviting teammates requires Team or Agency.",
    );
  if ((await repo.pendingCount(organizationId, userId)) >= 20)
    throw new AppError("RATE_LIMITED");
  const row = await repo.request({
    id: crypto.randomUUID(),
    organizationId,
    projectId,
    requesterId: userId,
    email: email.toLowerCase(),
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  if (row) {
    await AuditLogService.recordUser(
      actor,
      "member.invitation_requested",
      "Requested an invitation for a project teammate",
      { projectId, targetKind: "invitation_request", targetId: row.id },
    );
  }
  return { ok: true as const };
}

async function review(actor: Actor, id: string, approve: boolean) {
  requireOrgPermission(actor, { invitation: ["create"] });
  const now = Date.now();
  const at = new Date(now).toISOString();
  const { organizationId } = actor;
  const claimed = await repo.claim(
    organizationId,
    id,
    at,
    new Date(now - 300_000).toISOString(),
  );
  if (!claimed) throw new AppError("NOT_FOUND");

  try {
    let invitation: Awaited<ReturnType<typeof issueTeamInvitation>> | undefined;
    if (approve) {
      const [project, membership] = await Promise.all([
        ProjectRepository.getProjectForOrganization(
          claimed.projectId,
          organizationId,
        ),
        AuthRepository.getMembership(claimed.requesterId, organizationId),
      ]);
      if (!project || !membership)
        throw new AppError(
          "FORBIDDEN",
          "The requester no longer has access to this project.",
        );
      const allowed = await getAllowedProjectIds(
        claimed.requesterId,
        organizationId,
        membership.role,
      );
      if (allowed && !allowed.includes(claimed.projectId))
        throw new AppError(
          "FORBIDDEN",
          "The requester no longer has access to this project.",
        );
      invitation = await issueTeamInvitation(
        actor,
        {
          email: claimed.email,
          role: "project_member",
          projectIds: [claimed.projectId],
        },
        false,
      );
    }
    await repo.review(
      organizationId,
      id,
      at,
      approve ? "approved" : "declined",
    );
    await AuditLogService.recordUser(
      actor,
      approve ? "member.invitation_approved" : "member.invitation_declined",
      approve
        ? "Approved a project invitation request"
        : "Declined a project invitation request",
      {
        projectId: claimed.projectId,
        targetKind: "invitation_request",
        targetId: claimed.id,
      },
    );
    return { invitation };
  } catch (error) {
    await repo.review(organizationId, id, at, "pending");
    throw error;
  }
}

export const InvitationRequestService = { list, request, review };
