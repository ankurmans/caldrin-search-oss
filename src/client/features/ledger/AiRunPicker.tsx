import { groupBy, sort } from "remeda";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import type { MeasurementRunSummary } from "@/server/features/ai-visibility/services/aiMeasurementRuns";
import { formatTime } from "./helpers";

// Runs grouped by prompt-set version, newest version first. Runs inside a
// group may still differ in engines or market; the comparison refuses those.
function groupRuns(runs: MeasurementRunSummary[]) {
  const groups = Object.values(
    groupBy(runs, (run) => run.promptSetVersionId ?? "unversioned"),
  );
  return sort(
    groups,
    (a, b) => (b[0].promptSetVersion ?? 0) - (a[0].promptSetVersion ?? 0),
  );
}

function runDetail(run: MeasurementRunSummary): string {
  const parts = [
    run.engines.join(", ") || "no engine recorded",
    `${run.promptsCount} prompts`,
    run.models.length > 0 ? `model ${run.models.join(", ")}` : null,
    run.status === "partial" ? "partial" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function describeSelection(
  runs: MeasurementRunSummary[],
  selected: string[],
): string {
  const chosen = runs.filter((run) => selected.includes(run.id));
  if (chosen.length === 0) return "No runs selected.";
  const labels = [...new Set(chosen.map((run) => run.promptSetLabel))];
  return `${chosen.length} runs selected (${labels.join(" and ")}).`;
}

export function AiRunPicker({
  legend,
  idPrefix,
  runs,
  selected,
  onChange,
}: {
  legend: string;
  idPrefix: string;
  runs: MeasurementRunSummary[];
  selected: string[];
  onChange: (runIds: string[]) => void;
}) {
  const toggle = (ids: string[], on: boolean) =>
    onChange(
      on
        ? [...new Set([...selected, ...ids])]
        : selected.filter((id) => !ids.includes(id)),
    );
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium">{legend}</legend>
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {groupRuns(runs).map((group) => {
          const ids = group.map((run) => run.id);
          const all = ids.every((id) => selected.includes(id));
          return (
            <div key={group[0].promptSetVersionId ?? "unversioned"}>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${idPrefix}-group-${group[0].promptSetVersionId ?? "unversioned"}`}
                  checked={all}
                  onCheckedChange={(checked) => toggle(ids, checked)}
                />
                <Label
                  htmlFor={`${idPrefix}-group-${group[0].promptSetVersionId ?? "unversioned"}`}
                  className="text-xs font-medium"
                >
                  {group[0].promptSetLabel} ({group.length} runs)
                </Label>
              </div>
              <ul className="mt-1 space-y-1 pl-6">
                {group.map((run) => (
                  <li key={run.id} className="flex items-start gap-2">
                    <Checkbox
                      id={`${idPrefix}-${run.id}`}
                      checked={selected.includes(run.id)}
                      onCheckedChange={(checked) => toggle([run.id], checked)}
                    />
                    <Label
                      htmlFor={`${idPrefix}-${run.id}`}
                      className="flex-col items-start gap-0 font-normal"
                    >
                      <span>{formatTime(run.createdAt)}</span>
                      <span className="text-xs text-muted-foreground">
                        {runDetail(run)}
                      </span>
                    </Label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {describeSelection(runs, selected)}
      </p>
    </fieldset>
  );
}
