import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCard,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  InviteTeammateModal,
  announceInvitation,
  inviteErrorMessage,
} from "@/client/features/team/InviteTeammateModal";
import { EditProjectAccessModal } from "@/client/features/team/EditProjectAccessModal";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import {
  InvitationRow,
  MemberRow,
  type Member,
} from "@/client/features/team/TeamTableRows";
import { TransferOwnershipModal } from "@/client/features/team/TransferOwnershipModal";
import { captureClientEvent } from "@/client/lib/posthog";
import { authClient, useSession } from "@/lib/auth-client";
import {
  INVITABLE_ROLES,
  hasOrgPermission,
  roleUsesProjectAccess,
  type InvitableRole,
} from "@/lib/org-permissions";
import { ProjectInvitationRequests } from "./ProjectInvitationRequests";
import { getTeam, sendTeamInvitation } from "@/serverFunctions/organization";

const RESEND_KEY = ["team", "resend-invitation"];
const REMOVE_KEY = ["team", "remove-member"];
const CANCEL_KEY = ["team", "cancel-invitation"];

// Every in-flight call for one action, so each row stays disabled while its
// own request runs even when another row starts the same action.
function usePendingVariables(mutationKey: string[]) {
  return useMutationState({
    filters: { mutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables,
  });
}

function toInvitableRole(role: string): InvitableRole {
  return INVITABLE_ROLES.find((candidate) => candidate === role) ?? "admin";
}

function groupIds<T extends { projectId: string }>(
  rows: T[],
  key: (row: T) => string,
) {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    map.set(key(row), [...(map.get(key(row)) ?? []), row.projectId]);
  }
  return map;
}

// The Organization tab of account settings: who has access to the active org.
export function TeamSettings() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [inviteType, setInviteType] = useState<"teammate" | "client" | null>(
    null,
  );
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);
  const [accessTarget, setAccessTarget] = useState<Member | null>(null);
  const projectsQuery = useQuery(projectsQueryOptions());

  const orgContextQuery = useQuery(organizationContextQueryOptions());

  const teamQuery = useQuery({
    queryKey: ["organization-team", orgContextQuery.data?.organizationId],
    queryFn: () => getTeam(),
    enabled: orgContextQuery.data?.organizationId !== undefined,
  });

  const refreshTeam = () =>
    queryClient.invalidateQueries({
      queryKey: ["organization-team", orgContextQuery.data?.organizationId],
    });

  // Same server call as inviting: for an already-pending address it re-mails
  // the same link with a refreshed expiry.
  const resendMutation = useMutation({
    mutationKey: RESEND_KEY,
    mutationFn: (invitation: { email: string; role: string; ids: string[] }) =>
      sendTeamInvitation({
        data: {
          email: invitation.email,
          role: toInvitableRole(invitation.role),
          projectIds: invitation.ids,
        },
      }),
    onSuccess: (result) => {
      captureClientEvent("team:invitation_resend");
      announceInvitation(result, "Invitation resent");
      void refreshTeam();
    },
    onError: (error: Error) => {
      toast.error(inviteErrorMessage(error));
    },
  });

  const removeMemberMutation = useMutation({
    mutationKey: REMOVE_KEY,
    mutationFn: async (memberId: string) => {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
      });
      if (result.error) {
        throw new Error(result.error.message || "Failed to remove the member");
      }
    },
    onSuccess: () => {
      captureClientEvent("team:member_remove");
      toast.success("Member removed");
      void refreshTeam();
    },
  });

  const cancelInvitationMutation = useMutation({
    mutationKey: CANCEL_KEY,
    mutationFn: async (invitationId: string) => {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      });
      if (result.error) {
        throw new Error(
          result.error.message || "Failed to cancel the invitation",
        );
      }
    },
    onSuccess: () => {
      captureClientEvent("team:invitation_cancel");
      toast.success("Invitation canceled");
      void refreshTeam();
    },
  });

  const pendingResends = usePendingVariables(RESEND_KEY);
  const pendingRemovals = usePendingVariables(REMOVE_KEY);
  const pendingCancels = usePendingVariables(CANCEL_KEY);

  const role = orgContextQuery.data?.role ?? "member";
  const canManageTeam = hasOrgPermission(role, { invitation: ["create"] });
  // billing:manage is the owner-only statement (organization:delete is
  // disabled app-wide, so it would read as a dead capability).
  const isOwner = hasOrgPermission(role, { billing: ["manage"] });

  const platform = teamQuery.data?.platform;
  const members = teamQuery.data?.members ?? [];
  const pendingInvitations = teamQuery.data?.pendingInvitations ?? [];

  const projectNameById = new Map(
    (projectsQuery.data ?? []).map((project) => [project.id, project.name]),
  );
  const memberProjectIds = groupIds(
    teamQuery.data?.memberProjects ?? [],
    (row) => row.userId,
  );
  const invitationProjectIds = groupIds(
    teamQuery.data?.invitationProjects ?? [],
    (row) => row.invitationId,
  );
  const namesFor = (ids: string[]) =>
    ids.map((id) => projectNameById.get(id) ?? "Archived project");

  // The team query waits on the org context, so a failed context would
  // otherwise leave the team spinner up for good. A failed refetch keeps the
  // loaded table, with the error above it.
  const failedQuery = [orgContextQuery, teamQuery].find(
    (query) => query.isError,
  );
  const loadError = failedQuery ? (
    <QueryError
      error={failedQuery.error}
      fallback="We couldn't load your team right now."
      onRetry={() => void failedQuery.refetch()}
      isRetrying={failedQuery.isFetching}
    />
  ) : null;
  if (failedQuery && failedQuery.data === undefined) return loadError;

  return (
    <section id="members" className="space-y-3">
      <SectionHeader
        title="Members"
        action={
          canManageTeam && platform?.canInvite ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setInviteType("teammate")}>
                Invite teammate
              </Button>
              {platform.canInviteGuests ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setInviteType("client")}
                >
                  Invite client
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={
                    <Link to="/settings/billing" hash="workspace-plans" />
                  }
                >
                  Client logins with Agency
                </Button>
              )}
            </div>
          ) : platform && !platform.canInvite ? (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/settings/billing" />}
            >
              See team plans
            </Button>
          ) : null
        }
      />
      {platform && !platform.canInvite ? (
        <p className="text-sm text-muted-foreground">
          Inviting teammates requires Team or Agency.
        </p>
      ) : null}
      {orgContextQuery.isSuccess ? (
        <ProjectInvitationRequests
          organizationId={orgContextQuery.data.organizationId}
          canReview={canManageTeam}
          projects={projectsQuery.data ?? []}
          refreshTeam={refreshTeam}
        />
      ) : null}
      {loadError}

      {teamQuery.isPending ? (
        <SkeletonCard />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  isSelf={member.userId === session?.user?.id}
                  canManageTeam={canManageTeam}
                  isOwner={isOwner}
                  isRemoving={pendingRemovals.includes(member.id)}
                  onRemove={() => removeMemberMutation.mutate(member.id)}
                  onTransferOwnership={() => setTransferTarget(member)}
                  projectNames={
                    roleUsesProjectAccess(member.role)
                      ? namesFor(memberProjectIds.get(member.userId) ?? [])
                      : undefined
                  }
                  onEditProjects={
                    roleUsesProjectAccess(member.role)
                      ? () => setAccessTarget(member)
                      : undefined
                  }
                />
              ))}
              {pendingInvitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  canManageTeam={canManageTeam}
                  isResending={pendingResends.includes(invitation.email)}
                  isCanceling={pendingCancels.includes(invitation.id)}
                  projectNames={
                    roleUsesProjectAccess(invitation.role ?? "")
                      ? namesFor(invitationProjectIds.get(invitation.id) ?? [])
                      : undefined
                  }
                  onCopyLink={() =>
                    announceInvitation(
                      {
                        invitationId: invitation.id,
                        inviteUrl: invitation.inviteUrl,
                      },
                      "Invitation link ready",
                    )
                  }
                  onResend={
                    (
                      invitation.role === "scoped"
                        ? platform?.canInviteGuests
                        : platform?.canInvite
                    )
                      ? () =>
                          resendMutation.mutate({
                            email: invitation.email,
                            role: invitation.role ?? "admin",
                            ids: invitationProjectIds.get(invitation.id) ?? [],
                          })
                      : undefined
                  }
                  onCancel={() =>
                    cancelInvitationMutation.mutate(invitation.id)
                  }
                />
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}

      {transferTarget ? (
        <TransferOwnershipModal
          member={transferTarget}
          onClose={() => setTransferTarget(null)}
          onTransferred={() => {
            // The caller's own role changed too: refresh the org context that
            // gates the team and billing UI, not only the member list.
            void refreshTeam();
            void queryClient.invalidateQueries({
              queryKey: organizationContextQueryOptions().queryKey,
            });
          }}
        />
      ) : null}

      {accessTarget ? (
        <EditProjectAccessModal
          userId={accessTarget.userId}
          email={accessTarget.user.email}
          initialProjectIds={memberProjectIds.get(accessTarget.userId) ?? []}
          onClose={() => setAccessTarget(null)}
          onSaved={() => void refreshTeam()}
        />
      ) : null}

      {inviteType ? (
        <InviteTeammateModal
          client={inviteType === "client"}
          onClose={() => setInviteType(null)}
          onInvited={() => void refreshTeam()}
        />
      ) : null}
    </section>
  );
}
