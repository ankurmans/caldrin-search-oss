import { APIError } from "better-auth/api";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth, getBaseUrl } from "@/lib/auth";
import {
  roleUsesProjectAccess,
  type InvitableRole,
} from "@/lib/org-permissions";
import { consumeInvitationSendBudget } from "@/server/auth/invitation-send-limit";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { setInvitationProjects } from "@/server/auth/project-access";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { requirePlatformSeat } from "@/server/features/billing/platformAccess";
import { AppError } from "@/server/lib/errors";

export function getTeamInvitationUrl(invitationId: string) {
  return `${getBaseUrl()}/accept-invitation/${encodeURIComponent(invitationId)}`;
}

export async function issueTeamInvitation(
  context: {
    userId: string;
    userEmail: string;
    organizationId: string;
    role: string;
  },
  data: { email: string; role: InvitableRole; projectIds: string[] },
  resend: boolean,
) {
  // Defense in depth: fail-closed locally before touching the rate-limit
  // budget or calling the plugin, so the budget cannot be exhausted by
  // low-privilege callers.
  requireOrgPermission(context, { invitation: ["create"] });

  await requirePlatformSeat(context.organizationId, data.role);
  await consumeInvitationSendBudget(context.organizationId, data.email);

  const invitation = await getAuth()
    .api.createInvitation({
      headers: getRequest().headers,
      body: {
        email: data.email,
        role: data.role,
        resend,
        // Bind the invitation to the request's resolved org, not the session's
        // active-organization hint, which can be stale after a switch.
        organizationId: context.organizationId,
      },
    })
    .catch((error: unknown) => {
      // The invite dialog shows this one inline, next to the email.
      if (
        error instanceof APIError &&
        error.body?.code === "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION"
      ) {
        throw new AppError("CONFLICT");
      }
      throw error;
    });

  await setInvitationProjects(
    context.organizationId,
    invitation.id,
    roleUsesProjectAccess(data.role) ? data.projectIds : [],
  );

  const inviteUrl = getTeamInvitationUrl(invitation.id);

  await AuditLogService.recordUser(
    context,
    "member.invited",
    `Invited ${data.email} as ${data.role}`,
    { targetKind: "invitation", targetId: invitation.id },
  );

  // The inviter passes the link on.
  return { invitationId: invitation.id, inviteUrl };
}
