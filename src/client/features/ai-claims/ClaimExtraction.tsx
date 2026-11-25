import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  cancelClaims,
  estimateClaims,
  startClaims,
  type getClaimOverview,
} from "@/serverFunctions/ai-claims";

export function ClaimExtraction({
  projectId,
  result,
  refresh,
}: {
  projectId: string;
  result: Awaited<ReturnType<typeof getClaimOverview>>;
  refresh: () => void;
}) {
  const [runId, setRunId] = useState("");
  const [funding, setFunding] = useState<"byok" | "hosted">("byok");
  const estimate = useMutation({
    mutationFn: () => estimateClaims({ data: { projectId, runId, funding } }),
  });
  const run = useMutation({
    mutationFn: (job: { id: string; calls: number }) =>
      startClaims({ data: { projectId, id: job.id, maxCalls: job.calls } }),
    onSuccess: () => {
      estimate.reset();
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelClaims({ data: { projectId, id } }),
    onSuccess: refresh,
  });
  return (
    <details
      className="rounded-xl border bg-card p-4"
      open={result.clusters.length === 0 || undefined}
    >
      <summary className="cursor-pointer font-medium">
        Extract claims from a saved run
      </summary>
      <p className="my-2 text-sm text-muted-foreground">
        Select one run and estimate up to 20 answers. Your own key uses zero
        Caldrin credits.
      </p>
      <div className="flex flex-wrap gap-2">
        {result.hostedAvailable && (
          <select
            aria-label="Extraction funding"
            className="h-9 rounded-md border bg-background px-2"
            value={funding}
            onChange={(event) => {
              setFunding(event.target.value === "hosted" ? "hosted" : "byok");
              estimate.reset();
            }}
          >
            <option value="byok">Use workspace AI key</option>
            <option value="hosted">Use purchased credits</option>
          </select>
        )}
        <select
          aria-label="Saved run"
          className="h-9 rounded-md border bg-background px-2"
          value={runId}
          onChange={(event) => {
            setRunId(event.target.value);
            estimate.reset();
          }}
        >
          <option value="">Choose a saved run</option>
          {result.runs.map((row) => (
            <option key={row.id} value={row.id}>
              {new Date(row.createdAt).toLocaleString()} · {row.locationCode} /{" "}
              {row.languageCode}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={!runId || estimate.isPending || run.isPending}
          onClick={() => estimate.mutate()}
        >
          Estimate extraction
        </Button>
        {estimate.data && (
          <Button
            size="sm"
            disabled={run.isPending}
            onClick={() => run.mutate(estimate.data)}
          >
            Confirm extraction
          </Button>
        )}
      </div>
      {estimate.data && (
        <p className="mt-2 text-sm">
          {estimate.data.included} selected · {estimate.data.excluded} outside
          this batch · up to {estimate.data.calls} model calls ·{" "}
          {estimate.data.model} · up to {estimate.data.credits} Caldrin credits
        </p>
      )}
      {(estimate.error || run.error || cancel.error) && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {getStandardErrorMessage(estimate.error || run.error || cancel.error)}
        </p>
      )}
      {result.jobs.map((job) => (
        <div
          key={job.id}
          className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
        >
          <div>
            <strong>{job.status}</strong> ·{" "}
            {Object.entries(job.counts)
              .map(([state, count]) => `${count} ${state}`)
              .join(" · ")}
            {job.errors.length > 0 && (
              <p className="text-muted-foreground">
                {job.errors
                  .map((error) => error.replaceAll("_", " "))
                  .join(" · ")}
              </p>
            )}
            {!!(job.inputTokens || job.outputTokens) && (
              <p className="text-muted-foreground">
                {job.inputTokens} input / {job.outputTokens} output tokens · $
                {job.knownUsd.toFixed(4)} USD recorded
                {job.unpriced ? ` · ${job.unpriced} unpriced` : ""}
              </p>
            )}
          </div>
          {["queued", "running"].includes(job.status) && (
            <Button
              size="sm"
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(job.id)}
            >
              Cancel pending work
            </Button>
          )}
        </div>
      ))}
    </details>
  );
}
