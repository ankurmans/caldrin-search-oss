import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import {
  getEditorialDraftEstimate,
  retryQueuedRefresh,
  type listQueuedRefreshes,
} from "@/serverFunctions/contentEditorial";

type Job = Awaited<ReturnType<typeof listQueuedRefreshes>>[number];
const labels = {
  queued: "Queued",
  running: "Writing",
  ready: "Draft ready",
  failed: "Needs attention",
};

export function RefreshJobs({
  projectId,
  rows,
  onOpen,
  onChange,
}: {
  projectId: string;
  rows: Job[];
  onOpen: (assetId: string) => void;
  onChange: () => void;
}) {
  const [retrying, setRetrying] = useState<Job | null>(null);
  const { cost, showCosts } = useCostDisplay();
  const estimate = useQuery({
    queryKey: ["refresh-queue-estimate", projectId],
    queryFn: () =>
      getEditorialDraftEstimate({
        data: { projectId, query: "Existing page refresh" },
      }),
    enabled: retrying !== null,
  });
  const amount = cost(estimate.data?.draftUsd);
  const retry = useMutation({
    mutationFn: (jobId: string) =>
      retryQueuedRefresh({ data: { projectId, jobId } }),
    onSuccess: (result) => {
      if (result.ok) {
        setRetrying(null);
        onChange();
      } else toast.error(plainReason(result.reason, showCosts));
    },
    onError: () => toast.error("Could not retry the refresh."),
  });
  return (
    <>
      <ul aria-live="polite" className="divide-y rounded-md border">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{row.label}</span>
                <Badge variant="outline">{labels[row.status]}</Badge>
              </div>
              {row.reason ? (
                <p className="text-xs text-muted-foreground">
                  {plainReason(row.reason, showCosts)}
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              {row.assetId &&
              (row.status === "ready" || row.status === "failed") ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => row.assetId && onOpen(row.assetId)}
                >
                  Open draft
                </Button>
              ) : null}
              {row.status === "failed" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retry.isPending}
                  onClick={() => setRetrying(row)}
                >
                  Retry page
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <Dialog
        open={retrying !== null}
        onOpenChange={(open) => {
          if (!open && !retry.isPending) setRetrying(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retry this page?</DialogTitle>
            <DialogDescription>{retrying?.label}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {estimate.isError
              ? "Could not load the estimate."
              : amount
                ? `Estimated provider cost ${amount}`
                : "Uses your workspace’s AI allowance."}
          </p>
          <Button
            size="sm"
            pending={retry.isPending}
            disabled={!estimate.data}
            onClick={() => retrying && retry.mutate(retrying.id)}
          >
            Queue retry
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
