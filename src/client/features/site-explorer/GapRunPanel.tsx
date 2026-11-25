import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Spinner } from "@/client/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  estimateKeywordGap,
  getSavedCompetitors,
  runKeywordGap,
} from "@/serverFunctions/site-explorer";
import { GAP_DEPTHS, MAX_GAP_COMPETITORS } from "@/types/schemas/keyword-gap";
import { INCLUDED_NOTE, plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { gapKeys } from "./gap";

const DEPTH_ITEMS = GAP_DEPTHS.map((depth) => ({
  value: String(depth),
  label: `${depth} keywords per competitor`,
}));

/**
 * Starts a paid keyword gap. Opening the page or ticking a box reads stored
 * data only. "Preview cost" asks the server for an estimate (no provider call)
 * and the run needs a second, explicit click.
 */
export function GapRunPanel({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (runId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { showCosts, cost } = useCostDisplay();
  const competitorsQuery = useQuery({
    queryKey: gapKeys.competitors(projectId),
    queryFn: () => getSavedCompetitors({ data: { projectId } }),
  });
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [depth, setDepth] = useState<number>(100);
  const [includeOutranked, setIncludeOutranked] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [repeatAck, setRepeatAck] = useState(false);

  const saved = competitorsQuery.data ?? [];
  const selected =
    chosen ??
    saved.slice(0, MAX_GAP_COMPETITORS).map((competitor) => competitor.domain);

  const input = {
    competitors: selected,
    rowsPerCompetitor: depth,
    includeOutranked,
  };
  const estimateQuery = useQuery({
    queryKey: ["keywordGapEstimate", projectId, input],
    queryFn: () => estimateKeywordGap({ data: { projectId, input } }),
    enabled: previewing && selected.length > 0,
    staleTime: 0,
  });
  const estimate = estimateQuery.data;

  const runMutation = useMutation({
    mutationFn: () =>
      runKeywordGap({
        data: { projectId, input, repeat: repeatAck || undefined },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(plainReason(result.reason, showCosts));
        return;
      }
      const { data } = result;
      toast.success(
        `${data.rowCount} keywords stored${cost(data.costUsd) ? ` for ${cost(data.costUsd)}` : ""}${
          data.partial ? ". Some competitors could not be read." : ""
        }`,
      );
      setPreviewing(false);
      setRepeatAck(false);
      void queryClient.invalidateQueries({
        queryKey: gapKeys.table(projectId),
      });
      void queryClient.invalidateQueries({ queryKey: gapKeys.runs(projectId) });
      void queryClient.invalidateQueries({
        queryKey: gapKeys.competitors(projectId),
      });
      onDone(data.runId);
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "The run failed")),
  });

  function reset() {
    setPreviewing(false);
    setRepeatAck(false);
  }

  function toggle(domain: string, on: boolean) {
    reset();
    setChosen(
      on
        ? [...selected.filter((item) => item !== domain), domain]
        : selected.filter((item) => item !== domain),
    );
  }

  if (competitorsQuery.isLoading) {
    return <Spinner className="size-4" aria-label="Loading competitors" />;
  }

  if (saved.length === 0) {
    return (
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-base font-semibold">Pick competitors first</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A keyword gap compares your domain with up to {MAX_GAP_COMPETITORS}{" "}
          saved competitors. Add some, or look them up from your own keywords.
        </p>
        <Button
          className="mt-3"
          variant="outline"
          nativeButton={false}
          render={
            <Link to="/p/$projectId/competitors" params={{ projectId }} />
          }
        >
          Manage competitors
        </Button>
      </section>
    );
  }

  const needsRepeatAck = estimate?.ranToday != null && !repeatAck;

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold">Run a keyword gap</h2>
        <p className="text-sm text-muted-foreground">
          {showCosts
            ? "Reads DataForSEO's keyword rankings for each competitor and keeps the keywords you do not rank for. Nothing is charged until you confirm a cost preview."
            : "Reads keyword rankings for each competitor and keeps the keywords you do not rank for. Nothing runs until you confirm."}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Competitors ({selected.length} of {MAX_GAP_COMPETITORS} max)
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {saved.map((competitor) => {
            const on = selected.includes(competitor.domain);
            return (
              <label
                key={competitor.id}
                className="flex items-center gap-2 rounded-lg border p-2 text-sm"
              >
                <Checkbox
                  checked={on}
                  disabled={!on && selected.length >= MAX_GAP_COMPETITORS}
                  onCheckedChange={(next) => toggle(competitor.domain, next)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{competitor.domain}</span>
                  <span className="block text-xs text-muted-foreground">
                    {competitor.lastAnalysedAt
                      ? `Last read ${formatRelativeTime(competitor.lastAnalysedAt)}`
                      : "Not read yet"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Select
          items={DEPTH_ITEMS}
          value={String(depth)}
          onValueChange={(next) => {
            reset();
            setDepth(Number(next));
          }}
        >
          <SelectTrigger size="sm" aria-label="Keywords per competitor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEPTH_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={includeOutranked}
            onCheckedChange={(next) => {
              reset();
              setIncludeOutranked(next);
            }}
          />
          Also find keywords where a competitor outranks you (doubles the cost)
        </label>
      </div>

      {!previewing ? (
        <Button
          variant="outline"
          disabled={selected.length === 0}
          onClick={() => setPreviewing(true)}
        >
          {showCosts ? "Preview cost" : "Review run"}
        </Button>
      ) : estimateQuery.isLoading ? (
        <Spinner
          className="size-4"
          aria-label={showCosts ? "Estimating cost" : "Checking the run"}
        />
      ) : estimateQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {getStandardErrorMessage(estimateQuery.error, "Could not estimate")}
        </p>
      ) : estimate ? (
        <div className="space-y-3 rounded-lg border bg-muted/40 p-3 text-sm">
          {estimate.available ? (
            <>
              {showCosts ? (
                <p>
                  <strong>Up to {cost(estimate.estimatedUsd)}</strong> for{" "}
                  {estimate.providerReads} read
                  {estimate.providerReads === 1 ? "" : "s"} of {estimate.target}
                  . {estimate.basis}
                </p>
              ) : (
                <p>
                  {INCLUDED_NOTE} It reads keyword rankings for{" "}
                  {estimate.target} and its competitors.
                </p>
              )}
              {showCosts && estimate.remainingUsd !== null ? (
                <p className="text-muted-foreground">
                  {cost(estimate.remainingUsd)} left in this project&apos;s{" "}
                  {estimate.limitPeriod} limit.
                </p>
              ) : null}
              {estimate.ranToday ? (
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={repeatAck}
                    onCheckedChange={setRepeatAck}
                  />
                  {showCosts
                    ? `A run already cost ${cost(estimate.ranToday.costUsd)} `
                    : "A run already happened "}
                  {formatRelativeTime(estimate.ranToday.at)}. Run again anyway.
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={runMutation.isPending || needsRepeatAck}
                  onClick={() => runMutation.mutate()}
                >
                  {runMutation.isPending ? <Spinner /> : null}
                  {showCosts
                    ? `Run for up to ${cost(estimate.estimatedUsd)}`
                    : "Run keyword gap"}
                </Button>
                <Button variant="ghost" onClick={reset}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <p role="alert">{plainReason(estimate.reason, showCosts)}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
