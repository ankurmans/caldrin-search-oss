import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { announceInvitation } from "./InviteTeammateModal";
import {
  listInvitationRequests,
  requestProjectInvitation,
  reviewProjectInvitation,
} from "@/serverFunctions/invitationRequests";

type Project = { id: string; name: string };

export function ProjectInvitationRequests({
  organizationId,
  canReview,
  projects,
  refreshTeam,
}: {
  organizationId: string;
  canReview: boolean;
  projects: Project[];
  refreshTeam: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const key = ["project-invitation-requests", organizationId];
  const requests = useQuery({
    queryKey: key,
    queryFn: () => listInvitationRequests(),
  });
  const [email, setEmail] = useState("");
  const [projectId, setProjectId] = useState("");
  const selectedId = projects.some((project) => project.id === projectId)
    ? projectId
    : (projects[0]?.id ?? "");
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const submit = useMutation({
    mutationFn: () =>
      requestProjectInvitation({ data: { email, projectId: selectedId } }),
    onSuccess: () => {
      setEmail("");
      toast.success("Request sent to workspace admins");
      void refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const review = useMutation({
    mutationFn: (data: { id: string; approve: boolean }) =>
      reviewProjectInvitation({ data }),
    onSuccess: ({ invitation }) => {
      if (invitation) announceInvitation(invitation, "Invitation approved");
      else toast.success("Request declined");
      void refresh();
      void refreshTeam();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  if (!canReview && projects.length === 0 && !requests.data?.length)
    return null;

  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-label="Project invitation requests"
    >
      <h3 className="text-sm font-semibold">
        Project invitation requests
        {canReview && requests.data?.length ? ` (${requests.data.length})` : ""}
      </h3>
      {canReview && requests.isSuccess && requests.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No pending requests.</p>
      )}
      {requests.isError && (
        <p className="text-sm text-muted-foreground">
          Couldn’t load invitation requests.
        </p>
      )}
      {!canReview && projects.length > 0 && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (selectedId && !submit.isPending) submit.mutate();
          }}
        >
          <label className="grid flex-1 gap-1 text-sm">
            Teammate’s email
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="grid flex-1 gap-1 text-sm">
            Project
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selectedId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" pending={submit.isPending}>
            Request invite
          </Button>
        </form>
      )}
      {requests.data?.map((request) => (
        <div
          key={request.id}
          className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"
        >
          <div className="min-w-0 break-words">
            <p>{request.email}</p>
            <p className="text-muted-foreground">
              {projects.find(({ id }) => id === request.projectId)?.name ??
                "Unavailable project"}
              {!canReview &&
                ` · ${request.status === "processing" ? "pending" : request.status}`}
            </p>
          </div>
          {canReview && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={review.isPending}
                onClick={() =>
                  review.mutate({ id: request.id, approve: false })
                }
              >
                Decline
              </Button>
              <Button
                size="sm"
                disabled={review.isPending}
                onClick={() => review.mutate({ id: request.id, approve: true })}
              >
                Approve and copy invite
              </Button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
