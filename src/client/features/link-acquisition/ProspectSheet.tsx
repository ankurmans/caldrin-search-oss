/* eslint-disable max-lines-per-function */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { Textarea } from "@/client/components/ui/textarea";
import { formatCompactDate } from "@/client/features/backlinks/backlinksPageUtils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { useSession } from "@/lib/auth-client";
import {
  createLinkAssetOpportunity,
  generateLinkOutreach,
  getLinkProspect,
  matchLinkProspectAssets,
  updateLinkProspects,
} from "@/serverFunctions/link-acquisition";
import {
  LINK_CAMPAIGN_MODE_LABELS,
  LINK_DISCOVERY_METHOD_LABELS,
  LINK_PROSPECT_STATUS_LABELS,
  LINK_SIGNAL_LABELS,
} from "@/shared/link-acquisition";
import { prospectKeys, STATUS_VARIANT, type ProspectRow } from "./prospects";

export function ProspectSheet({
  projectId,
  row,
  onClose,
}: {
  projectId: string;
  row: ProspectRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const me = session.data?.user.id ?? null;
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const detail = useQuery({
    queryKey: [...prospectKeys.all(projectId), "detail", row?.id],
    enabled: row !== null,
    queryFn: () => getLinkProspect({ data: { projectId, id: row?.id ?? "" } }),
  });

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: prospectKeys.all(projectId),
    });
    void queryClient.invalidateQueries({
      queryKey: prospectKeys.outreach(projectId),
    });
  }

  // Server refusals come back as { ok: false, reason }; show them as written.
  function done<T>(
    result: { ok: true; data: T } | { ok: false; reason: string },
    message: (data: T) => string,
  ) {
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    toast.success(message(result.data));
    refresh();
  }
  const fail = (error: unknown) =>
    toast.error(getStandardErrorMessage(error, "Failed"));

  const patch = useMutation({
    mutationFn: (input: {
      patch: Parameters<
        typeof updateLinkProspects
      >[0]["data"]["input"]["patch"];
      note?: string;
    }) =>
      updateLinkProspects({
        data: {
          projectId,
          input: { ids: [row?.id ?? ""], patch: input.patch, note: input.note },
        },
      }),
    onSuccess: (result) => done(result, () => "Saved"),
    onError: fail,
  });
  const match = useMutation({
    mutationFn: () =>
      matchLinkProspectAssets({
        data: { projectId, input: { ids: [row?.id ?? ""] } },
      }),
    onSuccess: (result) => done(result, () => "Page match updated"),
    onError: fail,
  });
  const opportunity = useMutation({
    mutationFn: (withBrief: boolean) =>
      createLinkAssetOpportunity({
        data: {
          projectId,
          input: { prospectId: row?.id ?? "", withBrief },
        },
      }),
    onSuccess: (result) => done(result, () => "Added to Opportunities"),
    onError: fail,
  });
  const draft = useMutation({
    mutationFn: () =>
      generateLinkOutreach({
        data: {
          projectId,
          input: {
            prospectId: row?.id ?? "",
            contactName: contactName.trim() || null,
            contactEmail: contactEmail.trim() || null,
          },
        },
      }),
    onSuccess: (result) =>
      done(result, () => "Draft written. Review it in the Outreach tab."),
    onError: fail,
  });

  const events = detail.data?.events ?? [];
  const signals = detail.data?.signals ?? [];
  const targetValue = target ?? row?.targetUrl ?? "";

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle className="break-all">
                {row.referringDomain}
              </SheetTitle>
              <SheetDescription>
                {LINK_DISCOVERY_METHOD_LABELS[row.method]} ·{" "}
                {LINK_CAMPAIGN_MODE_LABELS[row.campaignMode]}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant={STATUS_VARIANT[row.status]}>
                  {LINK_PROSPECT_STATUS_LABELS[row.status]}
                </Badge>
                {row.score !== null ? (
                  <Badge variant="outline">Score {row.score}</Badge>
                ) : null}
                {row.recommendation ? (
                  <Badge variant="outline">{row.recommendation}</Badge>
                ) : null}
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Page to point to</h3>
                <p className="text-xs text-muted-foreground">
                  The page on your site this link should go to. Matching reads
                  your latest audit; it never invents a page.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={targetValue}
                    onChange={(event) => setTarget(event.target.value)}
                    placeholder="https://yoursite.com/page"
                    aria-label="Target page"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      patch.isPending || targetValue === (row.targetUrl ?? "")
                    }
                    onClick={() =>
                      patch.mutate({
                        patch: { targetUrl: targetValue || null },
                      })
                    }
                  >
                    Save
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={match.isPending}
                    onClick={() => match.mutate()}
                  >
                    Find a matching page
                  </Button>
                  {!row.targetUrl ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={opportunity.isPending}
                        onClick={() => opportunity.mutate(false)}
                      >
                        Add as opportunity
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={opportunity.isPending}
                        onClick={() => opportunity.mutate(true)}
                      >
                        Opportunity and brief
                      </Button>
                    </>
                  ) : null}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Assignment and notes</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!me || patch.isPending}
                    onClick={() =>
                      patch.mutate({
                        patch: {
                          assigneeUserId: row.assigneeUserId === me ? null : me,
                        },
                      })
                    }
                  >
                    {row.assigneeUserId === me
                      ? "Unassign me"
                      : row.assigneeUserId
                        ? "Take over"
                        : "Assign to me"}
                  </Button>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Due
                    <Input
                      type="date"
                      className="h-8 w-40"
                      defaultValue={row.dueDate ?? ""}
                      onBlur={(event) => {
                        const next = event.target.value || null;
                        if (next !== (row.dueDate ?? null))
                          patch.mutate({ patch: { dueDate: next } });
                      }}
                    />
                  </label>
                </div>
                <Textarea
                  defaultValue={row.notes ?? ""}
                  rows={3}
                  aria-label="Notes"
                  placeholder="Notes"
                  onBlur={(event) => {
                    const next = event.target.value.trim() || null;
                    if (next !== (row.notes ?? null))
                      patch.mutate({ patch: { notes: next } });
                  }}
                />
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Outreach draft</h3>
                <p className="text-xs text-muted-foreground">
                  Written from the pages we have on record. Add a contact only
                  if you know one; nothing is guessed. Caldrin does not send
                  email.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={contactName}
                    onChange={(event) => setContactName(event.target.value)}
                    placeholder="Contact name (optional)"
                    aria-label="Contact name"
                  />
                  <Input
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder="Contact email (optional)"
                    aria-label="Contact email"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={draft.isPending}
                  onClick={() => draft.mutate()}
                >
                  Write a draft
                </Button>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Move to</h3>
                <Input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Reason (optional)"
                  aria-label="Reason"
                />
                <div className="flex flex-wrap gap-2">
                  {(["qualified", "ready", "rejected"] as const).map(
                    (status) =>
                      status === row.status ? null : (
                        <Button
                          key={status}
                          variant="outline"
                          size="sm"
                          disabled={patch.isPending}
                          onClick={() =>
                            patch.mutate({
                              patch: { status },
                              note: note.trim() || undefined,
                            })
                          }
                        >
                          {LINK_PROSPECT_STATUS_LABELS[status]}
                        </Button>
                      ),
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Approved, contacted and acquired are set by approving a draft,
                  marking it sent, and a link check that finds the link.
                </p>
              </section>

              {signals.length > 0 ? (
                <section className="space-y-1">
                  <h3 className="text-sm font-semibold">Signals</h3>
                  <ul className="space-y-1">
                    {signals.map((signal) => (
                      <li key={signal.id} className="text-xs">
                        <span className="font-medium">
                          {LINK_SIGNAL_LABELS[signal.kind]}:
                        </span>{" "}
                        {signal.value}{" "}
                        <span className="text-muted-foreground">
                          ({signal.source},{" "}
                          {formatCompactDate(signal.observedAt)})
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="space-y-1">
                <h3 className="text-sm font-semibold">History</h3>
                {events.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No history yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {events.map((event) => (
                      <li key={event.id} className="text-xs">
                        <span className="text-muted-foreground">
                          {formatCompactDate(event.createdAt)} · {event.actor}
                        </span>{" "}
                        {event.fromStatus
                          ? `${LINK_PROSPECT_STATUS_LABELS[event.fromStatus]} → `
                          : ""}
                        {LINK_PROSPECT_STATUS_LABELS[event.toStatus]}
                        {event.note ? `: ${event.note}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
