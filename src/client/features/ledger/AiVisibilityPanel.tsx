import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import type { WindowComparison } from "@/server/features/ai-visibility/services/aiMeasurementTypes";
import type { LedgerEntry } from "@/server/features/ledger/types";
import {
  compareAiVisibilityWindows,
  linkAiRunsToLedgerEntry,
  listAiVisibilityRunsForMeasurement,
} from "@/serverFunctions/ai-measurement";
import { AiComparisonView } from "./AiComparisonView";
import { AiRunPicker } from "./AiRunPicker";
import { ledgerEntryKey, unwrap } from "./helpers";

const DAY_MS = 86_400_000;

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function toIso(local: string): string {
  return new Date(local).toISOString();
}

function defaultWindows(executedAt: string | null) {
  const pivot = executedAt ? new Date(executedAt) : new Date();
  const valid = Number.isNaN(pivot.getTime()) ? new Date() : pivot;
  return {
    beforeStart: toLocalInput(new Date(valid.getTime() - 14 * DAY_MS)),
    beforeEnd: toLocalInput(valid),
    afterStart: toLocalInput(valid),
    afterEnd: toLocalInput(new Date(valid.getTime() + 14 * DAY_MS)),
  };
}

type Fields = ReturnType<typeof defaultWindows>;
type Mode = "runs" | "windows";

export function AiVisibilityPanel({
  projectId,
  entry,
}: {
  projectId: string;
  entry: LedgerEntry;
}) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<Fields>(() =>
    defaultWindows(entry.executedAt),
  );
  const [mode, setMode] = useState<Mode>("runs");
  const [beforeRuns, setBeforeRuns] = useState<string[]>([]);
  const [afterRuns, setAfterRuns] = useState<string[]>([]);
  const [comparison, setComparison] = useState<WindowComparison | null>(null);
  const runList = useQuery({
    queryKey: ["ledger", projectId, "ai-runs"],
    queryFn: () => listAiVisibilityRunsForMeasurement({ data: { projectId } }),
  });
  const windowsValid =
    Object.values(fields).every(
      (v) => v !== "" && !Number.isNaN(Date.parse(v)),
    ) &&
    fields.beforeStart < fields.beforeEnd &&
    fields.afterStart < fields.afterEnd;

  const compare = useMutation({
    mutationFn: () =>
      compareAiVisibilityWindows({
        data:
          mode === "runs"
            ? { projectId, beforeRunIds: beforeRuns, afterRunIds: afterRuns }
            : {
                projectId,
                beforeWindow: {
                  start: toIso(fields.beforeStart),
                  end: toIso(fields.beforeEnd),
                },
                afterWindow: {
                  start: toIso(fields.afterStart),
                  end: toIso(fields.afterEnd),
                },
              },
      }),
    onSuccess: setComparison,
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Could not compare the two sets."),
      ),
  });
  const link = useMutation({
    mutationFn: (current: WindowComparison) =>
      linkAiRunsToLedgerEntry({
        data: {
          projectId,
          entryId: entry.id,
          baselineRunIds: current.before.runIds,
          followUpRunIds: current.after.runIds,
        },
      }),
    onSuccess: (result) => {
      const data = unwrap(result);
      if (!data) return;
      toast.success(
        `Recorded ${data.recorded} readings (${data.skipped} already recorded).`,
      );
      void queryClient.invalidateQueries({
        queryKey: ledgerEntryKey(projectId, entry.id),
      });
    },
  });
  const set = (key: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  const canCompare =
    mode === "runs"
      ? beforeRuns.length > 0 && afterRuns.length > 0
      : windowsValid;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Recorded AI visibility, before and after"
        hint="Compare finished AI visibility runs from before the change with runs from after it. Pick the runs yourself, or use a date window on each side."
      />
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Compare by"
      >
        {(
          [
            ["runs", "Pick runs"],
            ["windows", "Date windows"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={mode === value ? "default" : "outline"}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setComparison(null);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {mode === "runs" ? (
        <RunPickers
          query={runList}
          beforeRuns={beforeRuns}
          afterRuns={afterRuns}
          onBefore={setBeforeRuns}
          onAfter={setAfterRuns}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <WindowFields
            legend="Before window"
            start={fields.beforeStart}
            end={fields.beforeEnd}
            onStart={set("beforeStart")}
            onEnd={set("beforeEnd")}
          />
          <WindowFields
            legend="After window"
            start={fields.afterStart}
            end={fields.afterEnd}
            onStart={set("afterStart")}
            onEnd={set("afterEnd")}
          />
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        pending={compare.isPending}
        disabled={!canCompare}
        onClick={() => compare.mutate()}
      >
        {mode === "runs" ? "Compare selected runs" : "Compare recorded windows"}
      </Button>
      {mode === "windows" && !windowsValid ? (
        <p role="alert" className="text-xs text-destructive">
          Each window needs a start before its end.
        </p>
      ) : null}
      {comparison ? (
        <AiComparisonView
          comparison={comparison}
          linking={link.isPending}
          onLink={() => link.mutate(comparison)}
        />
      ) : null}
    </section>
  );
}

type RunList = Awaited<ReturnType<typeof listAiVisibilityRunsForMeasurement>>;

function RunPickers({
  query,
  beforeRuns,
  afterRuns,
  onBefore,
  onAfter,
}: {
  query: { data: RunList | undefined; isPending: boolean; isError: boolean };
  beforeRuns: string[];
  afterRuns: string[];
  onBefore: (ids: string[]) => void;
  onAfter: (ids: string[]) => void;
}) {
  if (query.isPending)
    return <p className="text-sm text-muted-foreground">Loading runs...</p>;
  if (query.isError || !query.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load the AI visibility runs.
      </p>
    );
  const { runs, truncated } = query.data;
  if (runs.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No finished AI visibility runs yet. Run a check first, then come back to
        compare.
      </p>
    );
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Runs are grouped by prompt set. Only runs of the same prompt set,
        engines and market can be compared; the comparison tells you when the
        two sets cannot be.
        {truncated ? " Only the most recent runs are listed." : ""}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <AiRunPicker
          legend="Before set"
          idPrefix="before-run"
          runs={runs}
          selected={beforeRuns}
          onChange={onBefore}
        />
        <AiRunPicker
          legend="After set"
          idPrefix="after-run"
          runs={runs}
          selected={afterRuns}
          onChange={onAfter}
        />
      </div>
    </div>
  );
}

function WindowFields({
  legend,
  start,
  end,
  onStart,
  onEnd,
}: {
  legend: string;
  start: string;
  end: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
}) {
  const id = legend.replaceAll(" ", "-").toLowerCase();
  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium">{legend}</legend>
      <div className="space-y-1">
        <Label htmlFor={`${id}-start`} className="text-xs">
          Start
        </Label>
        <Input
          id={`${id}-start`}
          type="datetime-local"
          value={start}
          onChange={(event) => onStart(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-end`} className="text-xs">
          End
        </Label>
        <Input
          id={`${id}-end`}
          type="datetime-local"
          value={end}
          onChange={(event) => onEnd(event.target.value)}
        />
      </div>
    </fieldset>
  );
}
