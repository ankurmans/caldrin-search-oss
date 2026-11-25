import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { AI_ENGINE_LABELS, type AiEngine } from "@/shared/ai-visibility";
import {
  INTEL_FORMULAS,
  type AiVisibilityIntelligence,
} from "@/shared/ai-visibility-intelligence";
import { EngineIcon } from "../EngineIcon";
import { FormulaNote, ofText, pct, shortDate } from "./insightsShared";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

function EngineBar({
  engine,
  visibility,
  answers,
  mentions,
}: {
  engine: AiEngine;
  visibility: number | null;
  answers: number;
  mentions: number;
}) {
  const width = visibility === null ? 0 : Math.round(visibility * 100);
  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <EngineIcon engine={engine} className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{AI_ENGINE_LABELS[engine]}</span>
        </span>
        <span className="shrink-0 tabular-nums">
          {pct(visibility)}
          <span className="ml-2 text-xs text-muted-foreground">
            named in {mentions} of {answers}
          </span>
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${AI_ENGINE_LABELS[engine]} visibility ${pct(visibility)}`}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${width}%` }}
        />
      </div>
    </li>
  );
}

export function InsightsScorecard({
  data,
  projectId,
}: {
  data: AiVisibilityIntelligence;
  projectId: string;
}) {
  const target = data.target;
  const { coverage } = data;
  const version = data.promptSet.versions.find((v) => v.selected);
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-4 md:p-6"
      aria-label="AI visibility scorecard"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              AI visibility{target ? ` for ${target.name}` : ""}
              <FormulaNote
                label="AI visibility"
                text={INTEL_FORMULAS.visibility}
              />
            </div>
            <p className="text-5xl font-semibold tracking-tight tabular-nums">
              {pct(target?.visibility ?? null)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {target?.rank
                ? `#${target.rank} of ${data.brandsCompared} tracked brands`
                : `${data.brandsCompared} tracked brand(s) compared`}
              {target ? ` · named in ${ofText(target.mention)} answers` : ""}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Engines are weighted equally. This describes the tracked prompts
              and engines below, not the whole market.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Stat label="Prompts" value={String(coverage.prompts)} />
            <Stat
              label="Answers"
              value={`${coverage.answered} of ${coverage.planned}`}
              hint="answered of planned"
            />
            <Stat label="Runs" value={String(coverage.contributingRuns)} />
            <Stat label="Engines" value={String(coverage.engines.length)} />
            <Stat
              label="Measured"
              value={
                data.observedWindow
                  ? `${shortDate(data.observedWindow.start)} – ${shortDate(data.observedWindow.end)}`
                  : "No runs"
              }
              hint={`last ${data.window.days} days`}
            />
            <Stat
              label="Prompt set"
              value={
                version?.version ? `Version ${version.version}` : "Unversioned"
              }
            />
          </dl>
          <p className="text-xs text-muted-foreground">
            {data.repeatRuns.note}
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Visibility by engine</h3>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  to="/p/$projectId/ai-visibility"
                  params={{ projectId }}
                  search={{ settings: "engines" }}
                />
              }
            >
              Manage engines
            </Button>
          </div>
          {target && target.byEngine.length ? (
            <ul className="space-y-3">
              {target.byEngine.map((engine) => (
                <EngineBar key={engine.engine} {...engine} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No answered collections in this period.
            </p>
          )}
          {data.models.some((m) => m.models.length) ? (
            <p className="text-xs text-muted-foreground">
              Models reported:{" "}
              {data.models
                .filter((m) => m.models.length)
                .map(
                  (m) => `${AI_ENGINE_LABELS[m.engine]} ${m.models.join(", ")}`,
                )
                .join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
      {data.warnings.length ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription>
            <ul className="space-y-1">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
