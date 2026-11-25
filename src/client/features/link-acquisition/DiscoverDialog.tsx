import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Textarea } from "@/client/components/ui/textarea";
import { INCLUDED_NOTE, plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  checkLinkMentions,
  estimateLinkRecovery,
  runLinkRecovery,
} from "@/serverFunctions/link-acquisition";
import { prospectKeys } from "./prospects";

type Kind = "lost" | "broken";

const COPY: Record<Kind, { title: string; blurb: string }> = {
  lost: {
    title: "Links you lost",
    blurb:
      "Sites that used to link to you. Each page is fetched to confirm the link is really gone before it becomes a prospect.",
  },
  broken: {
    title: "Links pointing at dead pages",
    blurb:
      "Links to your site that land on a page that no longer works. Each page is fetched again to confirm it is still broken. The fix is on your site.",
  },
};

function RecoveryCard({
  projectId,
  kind,
  onSaved,
}: {
  projectId: string;
  kind: Kind;
  onSaved: () => void;
}) {
  const { showCosts, cost } = useCostDisplay();
  const [previewing, setPreviewing] = useState(false);
  const [repeatAck, setRepeatAck] = useState(false);
  const estimateQuery = useQuery({
    queryKey: ["linkRecoveryEstimate", projectId, kind],
    queryFn: () =>
      estimateLinkRecovery({ data: { projectId, input: { kind } } }),
    enabled: previewing,
    staleTime: 0,
  });
  const result = estimateQuery.data;
  const estimate = result?.ok ? result.data : null;
  const run = useMutation({
    mutationFn: () =>
      runLinkRecovery({
        data: { projectId, input: { kind }, repeat: repeatAck || undefined },
      }),
    onSuccess: (outcome) => {
      if (!outcome.ok) {
        toast.error(plainReason(outcome.reason, showCosts));
        return;
      }
      const d = outcome.data;
      toast.success(
        `${d.read} checked: ${d.created} saved, ${d.alreadyFixed + d.stillLinking + d.pageGone} not worth pursuing, ${d.needsReview} to review by hand`,
      );
      setPreviewing(false);
      setRepeatAck(false);
      onSaved();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "The check failed")),
  });
  const needsAck = estimate?.ranToday != null && !repeatAck;

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">{COPY[kind].title}</h3>
      <p className="text-xs text-muted-foreground">{COPY[kind].blurb}</p>
      {!previewing ? (
        <Button size="sm" variant="outline" onClick={() => setPreviewing(true)}>
          Preview cost
        </Button>
      ) : estimateQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Estimating…</p>
      ) : result && !result.ok ? (
        <p role="alert" className="text-sm">
          {plainReason(result.reason, showCosts)}
        </p>
      ) : estimate?.available ? (
        <div className="space-y-2 text-sm">
          <p>
            {showCosts ? (
              <>
                <strong>Up to {cost(estimate.estimatedUsd)}</strong>.{" "}
                {estimate.basis}
              </>
            ) : (
              INCLUDED_NOTE
            )}
          </p>
          {estimate.ranToday ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={repeatAck}
                onChange={(event) => setRepeatAck(event.target.checked)}
              />
              Already run {formatRelativeTime(estimate.ranToday.at)}. Run again
              anyway.
            </label>
          ) : null}
          <Button
            size="sm"
            disabled={run.isPending || needsAck}
            onClick={() => run.mutate()}
          >
            {run.isPending ? "Finding and checking…" : "Find and check"}
          </Button>
        </div>
      ) : (
        <p role="alert" className="text-sm">
          {plainReason(estimate?.reason ?? "Not available.", showCosts)}
        </p>
      )}
    </section>
  );
}

function MentionCard({
  projectId,
  onSaved,
}: {
  projectId: string;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const urls = text
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const check = useMutation({
    mutationFn: () =>
      checkLinkMentions({ data: { projectId, input: { urls } } }),
    onSuccess: (outcome) => {
      if (!outcome.ok) return void toast.error(outcome.reason);
      const d = outcome.data;
      toast.success(
        `${d.checked} pages read: ${d.created} unlinked mentions saved, ${d.alreadyLinked} already link to you, ${d.notMentioned} do not mention you, ${d.unreadable} could not be read`,
      );
      setText("");
      onSaved();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "The check failed")),
  });
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">Mentions without a link</h3>
      <p className="text-xs text-muted-foreground">
        Paste up to 20 page addresses, one per line. Each page is fetched; only
        those that name you in their text and link nowhere to your site are
        saved, with the sentence as evidence. Free.
      </p>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="https://example.com/best-tools"
        rows={4}
        aria-label="Page addresses"
      />
      <Button
        size="sm"
        disabled={urls.length === 0 || check.isPending}
        onClick={() => check.mutate()}
      >
        {check.isPending ? "Reading pages…" : "Check pages"}
      </Button>
    </section>
  );
}

export function DiscoverDialog({
  projectId,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const saved = () => {
    void queryClient.invalidateQueries({
      queryKey: prospectKeys.all(projectId),
    });
    onSaved();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Find recoverable links</DialogTitle>
          <DialogDescription>
            Nothing runs until you click. Every result is confirmed by fetching
            the page, not taken from provider data alone.
          </DialogDescription>
        </DialogHeader>
        <RecoveryCard projectId={projectId} kind="lost" onSaved={saved} />
        <RecoveryCard projectId={projectId} kind="broken" onSaved={saved} />
        <MentionCard projectId={projectId} onSaved={saved} />
      </DialogContent>
    </Dialog>
  );
}
