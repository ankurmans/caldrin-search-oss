import { toast } from "sonner";
import { plainReason } from "@/client/features/spend/costText";
import { RefreshJobs } from "./RefreshJobs";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { CardShell } from "@/client/components/CardShell";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { canQueueRefresh, REFRESH_QUEUE_LIMIT } from "@/shared/refreshQueue";
import {
  getEditorialDraftEstimate,
  enqueueContentRefresh,
  listQueuedRefreshes,
} from "@/serverFunctions/contentEditorial";
import type { getContentOverview } from "@/serverFunctions/content";

type Opportunity = Awaited<
  ReturnType<typeof getContentOverview>
>["opportunities"][number];

export function RefreshQueue({
  projectId,
  opportunities,
  onOpen,
  onChange,
}: {
  projectId: string;
  opportunities: Opportunity[];
  onOpen: (assetId: string) => void;
  onChange: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const jobs = useQuery({
    queryKey: ["content-refresh-jobs", projectId],
    queryFn: () => listQueuedRefreshes({ data: { projectId } }),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.some(
        (job) => job.status === "queued" || job.status === "running",
      )
        ? 3500
        : false,
  });
  const results = jobs.data ?? [];
  const finishedJobs = jobs.data
    ?.filter((job) => job.status === "ready" || job.status === "failed")
    .map((job) => `${job.id}:${job.status}`)
    .join(",");
  useEffect(() => {
    if (finishedJobs) onChange();
  }, [finishedJobs, onChange]);

  const existing = new Set(results.map((job) => job.opportunityId));
  const choices = opportunities.filter(
    (row) => canQueueRefresh(row) && !existing.has(row.id),
  );
  const picked = choices.filter((row) => selected.includes(row.id));
  const { cost, showCosts } = useCostDisplay();
  const estimate = useQuery({
    queryKey: ["refresh-queue-estimate", projectId],
    queryFn: () =>
      getEditorialDraftEstimate({
        data: { projectId, query: "Existing page refresh" },
      }),
    enabled: confirm,
  });
  const run = useMutation({
    mutationFn: (opportunityIds: string[]) =>
      enqueueContentRefresh({ data: { projectId, opportunityIds } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(plainReason(result.reason, showCosts));
        return;
      }
      void jobs.refetch();
      setSelected([]);
      setConfirm(false);
    },
    onError: () => toast.error("Could not queue the refreshes."),
  });
  const amount = cost(estimate.data && estimate.data.draftUsd * picked.length);

  return (
    <CardShell title="Content refresh queue">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Select up to {REFRESH_QUEUE_LIMIT} existing pages. AI uses each page
          and its saved evidence to prepare a draft for review. Drafts keep
          running when you leave this page.
        </p>
        {!choices.length && !results.length ? (
          <p className="text-sm text-muted-foreground">
            No open refresh opportunities yet.
          </p>
        ) : null}
        {choices.length > 0 ? (
          <ul className="max-h-60 divide-y overflow-y-auto rounded-md border">
            {choices.map((row) => (
              <li key={row.id}>
                <label className="flex items-start gap-3 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.includes(row.id)}
                    disabled={
                      run.isPending ||
                      (!selected.includes(row.id) &&
                        picked.length >= REFRESH_QUEUE_LIMIT)
                    }
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setConfirm(false);
                      setSelected((ids) =>
                        checked
                          ? [...ids, row.id]
                          : ids.filter((id) => id !== row.id),
                      );
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{row.query}</span>
                    <span
                      className="block truncate text-xs text-muted-foreground"
                      title={row.pageUrl ?? undefined}
                    >
                      {row.pageUrl}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        {jobs.isError ? (
          <p role="alert" className="text-sm">
            Could not load refresh jobs.
          </p>
        ) : null}
        {results.length ? (
          <RefreshJobs
            projectId={projectId}
            rows={results}
            onOpen={(assetId) => {
              onChange();
              onOpen(assetId);
            }}
            onChange={() => void jobs.refetch()}
          />
        ) : null}
        {picked.length || run.isPending ? (
          <div className="flex flex-wrap items-center gap-2">
            {confirm ? (
              <>
                <Button
                  size="sm"
                  pending={run.isPending}
                  disabled={!estimate.data || !picked.length || run.isPending}
                  onClick={() => run.mutate(picked.map((row) => row.id))}
                >
                  Queue drafts
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={run.isPending}
                  onClick={() => setConfirm(false)}
                >
                  Cancel
                </Button>
                <p className="text-xs text-muted-foreground">
                  {estimate.isError
                    ? "Estimate unavailable. Close and try again."
                    : amount
                      ? `Estimated provider cost ${amount}`
                      : "Uses the workspace’s AI allowance."}
                </p>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirm(true)}
              >
                Review {picked.length} selected
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}
