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
import { INCLUDED_NOTE, plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  estimateLinkGap,
  runLinkGap,
} from "@/serverFunctions/link-acquisition";
import { getSavedCompetitors } from "@/serverFunctions/site-explorer";
import { LINK_GAP_MAX_COMPETITORS } from "@/shared/link-acquisition";
import {
  LINK_GAP_ROW_LIMITS,
  type LinkGapRunInput,
} from "@/types/schemas/link-acquisition";
import { gapKeys } from "@/client/features/site-explorer/gap";
import { linkGapKeys } from "./linkGap";

const LIMIT_ITEMS = LINK_GAP_ROW_LIMITS.map((value) => ({
  value: String(value),
  label: `${value} referring domains per read`,
}));
const MODE_ITEMS = [
  { value: "partial", label: "Link to any compared competitor" },
  { value: "all", label: "Link to every compared competitor" },
];
const STATUS_ITEMS = [
  { value: "live", label: "Links that are live" },
  { value: "lost", label: "Links competitors lost" },
];

/**
 * Starts a paid link gap. Opening the tab reads stored data only. "Preview
 * cost" asks the server for an estimate (no provider call); the run needs a
 * second, explicit click.
 */
export function LinkGapRunPanel({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { showCosts, cost } = useCostDisplay();
  const competitorsQuery = useQuery({
    queryKey: gapKeys.competitors(projectId),
    queryFn: () => getSavedCompetitors({ data: { projectId } }),
  });
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"partial" | "all">("partial");
  const [linkStatus, setLinkStatus] = useState<"live" | "lost">("live");
  const [rowLimit, setRowLimit] = useState(100);
  const [includeSingle, setIncludeSingle] = useState(false);
  const [includeSubdomains, setIncludeSubdomains] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [repeatAck, setRepeatAck] = useState(false);

  const saved = competitorsQuery.data ?? [];
  const selected =
    chosen ??
    saved
      .slice(0, LINK_GAP_MAX_COMPETITORS)
      .map((competitor) => competitor.domain);

  const input: LinkGapRunInput = {
    competitors: selected,
    mode,
    includeSingle,
    linkStatus,
    includeSubdomains,
    rowLimit,
  };
  const estimateQuery = useQuery({
    queryKey: ["linkGapEstimate", projectId, input],
    queryFn: () => estimateLinkGap({ data: { projectId, input } }),
    enabled: previewing && selected.length > 0,
    staleTime: 0,
  });
  const estimate = estimateQuery.data;

  const runMutation = useMutation({
    mutationFn: () =>
      runLinkGap({
        data: { projectId, input, repeat: repeatAck || undefined },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(plainReason(result.reason, showCosts));
        return;
      }
      const { data } = result;
      toast.success(
        `${data.rowCount} referring domains stored${cost(data.costUsd) ? ` for ${cost(data.costUsd)}` : ""}${
          data.partial ? ". Some reads failed and were not charged." : ""
        }`,
      );
      setPreviewing(false);
      setRepeatAck(false);
      void queryClient.invalidateQueries({
        queryKey: linkGapKeys.table(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: linkGapKeys.runs(projectId),
      });
      onDone();
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
          A link gap compares your domain with up to {LINK_GAP_MAX_COMPETITORS}{" "}
          saved competitors. Add some, then come back.
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
  const multi = selected.length >= 2;

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold">
          Find sites linking to competitors
        </h2>
        <p className="text-sm text-muted-foreground">
          {showCosts
            ? "Reads DataForSEO's referring domains for each competitor and removes your own site. Nothing is charged until you confirm a cost preview."
            : "Reads the sites linking to each competitor and removes your own. Nothing runs until you confirm."}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Competitors ({selected.length} of {LINK_GAP_MAX_COMPETITORS} max)
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
                  disabled={!on && selected.length >= LINK_GAP_MAX_COMPETITORS}
                  onCheckedChange={(next) => toggle(competitor.domain, next)}
                />
                <span className="min-w-0 flex-1 truncate">
                  {competitor.domain}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          items={MODE_ITEMS}
          value={mode}
          disabled={!multi}
          onValueChange={(next) => {
            reset();
            setMode(next === "all" ? "all" : "partial");
          }}
        >
          <SelectTrigger size="sm" aria-label="Which sites to find">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODE_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={STATUS_ITEMS}
          value={linkStatus}
          onValueChange={(next) => {
            reset();
            setLinkStatus(next === "lost" ? "lost" : "live");
          }}
        >
          <SelectTrigger size="sm" aria-label="Link status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={LIMIT_ITEMS}
          value={String(rowLimit)}
          onValueChange={(next) => {
            reset();
            setRowLimit(Number(next));
          }}
        >
          <SelectTrigger size="sm" aria-label="Rows per read">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIMIT_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {multi ? (
          <label className="flex items-center gap-2">
            <Checkbox
              checked={includeSingle}
              onCheckedChange={(next) => {
                reset();
                setIncludeSingle(next);
              }}
            />
            Also read each competitor alone, to include sites that link to only
            one (one extra read per competitor)
          </label>
        ) : null}
        <label className="flex items-center gap-2">
          <Checkbox
            checked={includeSubdomains}
            onCheckedChange={(next) => {
              reset();
              setIncludeSubdomains(next);
            }}
          />
          Include competitor subdomains
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
          {estimate.available && estimate.estimatedUsd !== null ? (
            <>
              {showCosts ? (
                <p>
                  <strong>Up to {cost(estimate.estimatedUsd)}</strong> for{" "}
                  {estimate.providerReads} read
                  {estimate.providerReads === 1 ? "" : "s"}. {estimate.basis}
                </p>
              ) : (
                <p>
                  {INCLUDED_NOTE} It reads the sites linking to your
                  competitors.
                </p>
              )}
              {showCosts && estimate.remainingUsd !== null ? (
                <p className="text-muted-foreground">
                  {cost(estimate.remainingUsd)} left in this project&apos;s{" "}
                  {estimate.limitPeriod} limit.
                </p>
              ) : null}
              <p className="text-muted-foreground">
                The result lists referring domains with aggregate counts. Exact
                linking pages are a separate read you start per site.
              </p>
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
                    : "Run link gap"}
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
