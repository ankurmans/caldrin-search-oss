import {
  getTeamInvitationUrl,
  issueTeamInvitation,
} from "@/server/features/team/issueTeamInvitation";
import { getPlatformAccess } from "@/server/features/billing/platformAccess";
import {
  INVITABLE_ROLES,
  roleSeesAllProjects,
  roleUsesProjectAccess,
} from "@/lib/org-permissions";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import {
  getAllowedProjectIds,
  listInvitationProjects,
  listProjectAccessForOrganization,
  setMemberProjects,
} from "@/server/auth/project-access";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { transferOrganizationOwnership } from "@/server/auth/ownership-transfer";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { ProjectService } from "@/server/features/projects/services/ProjectService";
import { AppError } from "@/server/lib/errors";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

// The client's source of truth for "who am I in this organization": the active
// org, the caller's role from their member row (resolved server-side by
// ensure-user), and every organization they belong to (for the switcher). Used
// to gate billing/team UI; the server functions and better-auth endpoints
// re-enforce every permission regardless.
export const getOrganizationContext = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    const memberships = await AuthRepository.listMembershipsForUser(
      context.userId,
    );
    const active = memberships.find(
      (membership) => membership.organizationId === context.organizationId,
    );

    return {
      organizationId: context.organizationId,
      organizationName: active?.organizationName ?? "Organization",
      role: context.role,
      organizations: memberships,
    };
  });

// Team data for the organization settings tab. Pending invitations are
// sensitive (invitee emails, inviter ids) and should only be visible to callers
// who can manage invitations; the server filters them here so the client cannot
// bypass the gate by calling the underlying endpoint directly.
export const getTeam = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    const fullOrganization = await getAuth().api.getFullOrganization({
      headers: getRequest().headers,
      query: { organizationId: context.organizationId },
    });
    if (!fullOrganization) {
      throw new AppError("NOT_FOUND");
    }

    const canViewInvitations = hasOrgPermission(context.role, {
      invitation: ["create"],
    });
    const now = Date.now();
    const pendingInvitations = canViewInvitations
      ? (fullOrganization.invitations ?? []).filter(
          (invitation) =>
            invitation.status === "pending" &&
            new Date(invitation.expiresAt).getTime() > now,
        )
      : [];

    // Scoped members see only themselves: other clients' addresses are not
    // theirs to read.
    const members = context.allowedProjectIds
      ? (fullOrganization.members ?? []).filter(
          (member) => member.userId === context.userId,
        )
      : (fullOrganization.members ?? []);

    const [memberAccess, invitationAccess] = canViewInvitations
      ? await Promise.all([
          listProjectAccessForOrganization(context.organizationId),
          listInvitationProjects(pendingInvitations.map((i) => i.id)),
        ])
      : [[], []];

    return {
      members,
      pendingInvitations: pendingInvitations.map((invitation) => ({
        ...invitation,
        inviteUrl: getTeamInvitationUrl(invitation.id),
      })),
      memberProjects: memberAccess,
      invitationProjects: invitationAccess,
      platform: canViewInvitations
        ? await getPlatformAccess(context.organizationId)
        : null,
    };
  });

const setMemberProjectsSchema = z.object({
  userId: z.string().min(1),
  projectIds: z.array(z.string().min(1)).max(200),
});

// Replace the projects a scoped member can open. Only scoped members: other
// roles see everything, so rows for them would be meaningless.
export const setMemberProjectAccess = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(setMemberProjectsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { invitation: ["create"] });
    const membership = await AuthRepository.getMembership(
      data.userId,
      context.organizationId,
    );
    if (!membership || roleSeesAllProjects(membership.role)) {
      throw new AppError("NOT_FOUND");
    }
    await setMemberProjects(
      context.organizationId,
      data.userId,
      data.projectIds,
    );
    await AuditLogService.recordUser(
      context,
      "member.project_access_changed",
      `Set project access for a scoped member (${data.projectIds.length} projects)`,
      { targetKind: "user", targetId: data.userId },
    );
    return { ok: true as const };
  });

const switchOrganizationSchema = z.object({
  organizationId: z.string().min(1),
});

// Make one of the user's organizations active and persist the choice so the
// next sign-in lands in the same org (session hook reads
// user.lastActiveOrganizationId).
async function activateOrganization(userId: string, organizationId: string) {
  const membership = await AuthRepository.getMembership(userId, organizationId);
  if (!membership) {
    throw new AppError("NOT_FOUND");
  }

  await getAuth().api.setActiveOrganization({
    headers: getRequest().headers,
    body: { organizationId },
  });
  await AuthRepository.setLastActiveOrganization(userId, organizationId);
}

export const switchOrganization = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(switchOrganizationSchema)
  .handler(async ({ data, context }) => {
    await activateOrganization(context.userId, data.organizationId);
    return { organizationId: data.organizationId };
  });

// A link to a project in another of the user's organizations (one an agent
// set up as a guest, then claimed, or a teammate's) opens it in that
// organization instead of bouncing to the active one's home page.
export const switchToProjectOrganization = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const organizationId = await ProjectService.getProjectOrganizationId(
      data.projectId,
    );
    if (!organizationId) throw new AppError("NOT_FOUND");
    const membership = await AuthRepository.getMembership(
      context.userId,
      organizationId,
    );
    if (!membership) throw new AppError("NOT_FOUND");
    const allowed = await getAllowedProjectIds(
      context.userId,
      organizationId,
      membership.role,
    );
    if (allowed && !allowed.includes(data.projectId))
      throw new AppError("NOT_FOUND");
    await activateOrganization(context.userId, organizationId);
    return { organizationId };
  });

const sendInvitationSchema = z
  .object({
    email: z.string().email(),
    role: z.enum(INVITABLE_ROLES).default("project_member"),
    projectIds: z.array(z.string().min(1)).max(200).default([]),
  })
  .refine(
    (value) =>
      !roleUsesProjectAccess(value.role) || value.projectIds.length > 0,
    {
      message: "Pick at least one project.",
      path: ["projectIds"],
    },
  );

// Invite (or re-invite) a teammate. better-auth creates the pending
// invitation — its server-side checks (inviter must be a member with invite
// permission, admin-only role lock, 20-pending cap) all still run — but the
// email is sent here rather than via the plugin's sendInvitationEmail
// callback: better-auth swallows throws from that callback, so a failed send
// would still read as "sent". Here it fails the call. resend: true re-mails
// an existing pending invitation with the same link and a refreshed expiry.
export const sendTeamInvitation = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(sendInvitationSchema)
  .handler(async ({ data, context }) => {
    return issueTeamInvitation(context, data, true);
  });

const transferOwnershipSchema = z.object({ memberId: z.string().min(1) });

// Owner-only. Runs here rather than through better-auth's update-member-role,
// which can't swap two roles atomically and refuses owner grants (see the
// beforeUpdateMemberRole hook in auth.ts).
export const transferOwnership = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(transferOwnershipSchema)
  .handler(async ({ data, context }) => {
    await transferOrganizationOwnership(context, data.memberId);
    await AuditLogService.recordUser(
      context,
      "member.ownership_transferred",
      "Transferred workspace ownership",
      { targetKind: "member", targetId: data.memberId },
    );
    return { memberId: data.memberId };
  });
