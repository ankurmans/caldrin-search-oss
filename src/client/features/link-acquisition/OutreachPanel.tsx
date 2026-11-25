import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import { formatCompactDate } from "@/client/features/backlinks/backlinksPageUtils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addLinkSuppression,
  approveLinkOutreach,
  editLinkOutreach,
  exportLinkOutreach,
  getLinkOutreach,
  logLinkOutreachReply,
  markLinkOutreachSent,
  removeLinkSuppression,
  withdrawLinkOutreach,
} from "@/serverFunctions/link-acquisition";
import { prospectKeys, type DraftRow } from "./prospects";

const STATUS_LABEL: Record<DraftRow["status"], string> = {
  draft: "Draft",
  approved: "Approved",
  exported: "Exported",
  sent: "Marked sent",
  withdrawn: "Withdrawn",
};

type Outcome<T> = { ok: true; data: T } | { ok: false; reason: string };

function Draft({
  projectId,
  draft,
  onChanged,
}: {
  projectId: string;
  draft: DraftRow;
  onChanged: () => void;
}) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [name, setName] = useState(draft.contactName ?? "");
  const [email, setEmail] = useState(draft.contactEmail ?? "");
  const [exported, setExported] = useState<string | null>(null);
  const editable = draft.status === "draft" || draft.status === "approved";
  const changed =
    subject !== draft.subject ||
    body !== draft.body ||
    name !== (draft.contactName ?? "") ||
    email !== (draft.contactEmail ?? "");

  function handle<T>(message: string) {
    return {
      onSuccess: (result: Outcome<T>) => {
        if (!result.ok) return void toast.error(result.reason);
        toast.success(message);
        onChanged();
      },
      onError: (error: unknown) =>
        toast.error(getStandardErrorMessage(error, "Failed")),
    };
  }
  const input = { draftId: draft.id };
  const replied = draft.events.some((event) => event.kind === "reply_logged");
  const save = useMutation({
    mutationFn: () =>
      editLinkOutreach({
        data: {
          projectId,
          input: {
            draftId: draft.id,
            subject,
            body,
            contactName: name.trim() || null,
            contactEmail: email.trim() || null,
          },
        },
      }),
    ...handle("Saved"),
  });
  const approve = useMutation({
    mutationFn: () => approveLinkOutreach({ data: { projectId, input } }),
    ...handle("Approved"),
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawLinkOutreach({ data: { projectId, input } }),
    ...handle("Withdrawn"),
  });
  const sent = useMutation({
    mutationFn: () => markLinkOutreachSent({ data: { projectId, input } }),
    ...handle("Marked as sent"),
  });
  const reply = useMutation({
    mutationFn: (outcome: "responded" | "declined" | "unsubscribed") =>
      logLinkOutreachReply({
        data: { projectId, input: { draftId: draft.id, outcome } },
      }),
    ...handle("Reply recorded"),
  });
  const exporter = useMutation({
    mutationFn: () => exportLinkOutreach({ data: { projectId, input } }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      const { to, subject: s, body: b } = result.data;
      const text = `${to ? `To: ${to}\n` : ""}Subject: ${s}\n\n${b}`;
      setExported(text);
      void navigator.clipboard?.writeText(text).then(
        () => toast.success("Copied. Caldrin has not sent anything."),
        () => toast.message("Copy the text below. Caldrin has not sent it."),
      );
      onChanged();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium break-all">{draft.referringDomain}</h3>
        <Badge variant={draft.status === "sent" ? "success" : "outline"}>
          {STATUS_LABEL[draft.status]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Written by {draft.createdBy}
          {draft.editedByUser ? ", edited by a person" : ""} ·{" "}
          {formatCompactDate(draft.createdAt)}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={name}
          disabled={!editable}
          onChange={(event) => setName(event.target.value)}
          placeholder="Contact name"
          aria-label="Contact name"
        />
        <Input
          value={email}
          disabled={!editable}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Contact email"
          aria-label="Contact email"
        />
      </div>
      <Input
        value={subject}
        disabled={!editable}
        onChange={(event) => setSubject(event.target.value)}
        aria-label="Subject"
      />
      <Textarea
        value={body}
        disabled={!editable}
        rows={9}
        onChange={(event) => setBody(event.target.value)}
        aria-label="Message"
      />
      {draft.status === "approved" && changed ? (
        <p className="text-xs text-muted-foreground">
          Saving a change to an approved draft takes the approval back.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {editable ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate()}
          >
            Save changes
          </Button>
        ) : null}
        {draft.status === "draft" ? (
          <Button
            size="sm"
            disabled={changed || approve.isPending}
            onClick={() => approve.mutate()}
          >
            Approve
          </Button>
        ) : null}
        {draft.status === "approved" || draft.status === "exported" ? (
          <>
            <Button
              size="sm"
              disabled={exporter.isPending}
              onClick={() => exporter.mutate()}
            >
              Copy to send yourself
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={sent.isPending}
              onClick={() => sent.mutate()}
            >
              I sent it
            </Button>
          </>
        ) : null}
        {draft.status === "sent" && replied ? (
          <span className="self-center text-xs text-muted-foreground">
            Reply recorded.
          </span>
        ) : null}
        {draft.status === "sent" && !replied ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={reply.isPending}
              onClick={() => reply.mutate("responded")}
            >
              They replied
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={reply.isPending}
              onClick={() => reply.mutate("declined")}
            >
              Declined
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={reply.isPending}
              onClick={() => reply.mutate("unsubscribed")}
            >
              Asked not to be contacted
            </Button>
          </>
        ) : null}
        {draft.status !== "withdrawn" && draft.status !== "sent" ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate()}
          >
            Withdraw
          </Button>
        ) : null}
      </div>
      {exported ? (
        <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
          {exported}
        </pre>
      ) : null}
    </Card>
  );
}

export function OutreachPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const query = useQuery({
    queryKey: prospectKeys.outreach(projectId),
    queryFn: () => getLinkOutreach({ data: { projectId } }),
  });
  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: prospectKeys.outreach(projectId),
    });
    void queryClient.invalidateQueries({
      queryKey: prospectKeys.all(projectId),
    });
  }
  const add = useMutation({
    mutationFn: () =>
      addLinkSuppression({ data: { projectId, input: { value } } }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      setValue("");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (entry: string) =>
      removeLinkSuppression({ data: { projectId, input: { value: entry } } }),
    onSuccess: refresh,
  });

  if (query.isError) {
    return (
      <QueryError
        error={query.error}
        fallback="Failed to load outreach"
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const drafts = query.data?.drafts ?? [];
  const suppressions = query.data?.suppressions ?? [];

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Drafts are written from the pages on record and never invent a
        relationship. You approve every message. Caldrin does not send email: it
        hands you the approved text, and you mark it sent once you have sent it.
      </p>
      {query.isLoading ? null : drafts.length === 0 ? (
        <EmptyState
          kind="no-data"
          title="No drafts yet"
          description="Open a prospect, choose the page it should link to, and write a draft."
        />
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <Draft
              key={`${draft.id}:${draft.updatedAt}`}
              projectId={projectId}
              draft={draft}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">Do not contact</h3>
        <p className="text-xs text-muted-foreground">
          Addresses and domains that cannot be approved for outreach. Declines
          and opt-outs are added when you record them.
        </p>
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="name@example.com or example.com"
            aria-label="Address or domain"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!value.trim() || add.isPending}
            onClick={() => add.mutate()}
          >
            Add
          </Button>
        </div>
        {suppressions.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {suppressions.map((entry) => (
              <li
                key={entry.value}
                className="flex items-center justify-between gap-2"
              >
                <span className="break-all">
                  {entry.value}{" "}
                  <span className="text-xs text-muted-foreground">
                    {entry.reason.replace(/_/g, " ")}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => remove.mutate(entry.value)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
