import { useState } from "react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  ofText,
  pct,
} from "@/client/features/ai-visibility/insights/insightsShared";
import type {
  ExperimentArmTally,
  ExperimentPromptResult,
  PerceptionExperiment,
} from "@/shared/ai-perception-experiments";

const CALL_LABEL = {
  moved_up: "Moved up",
  moved_down: "Moved down",
  within_noise: "Within noise",
  too_few_repeats: "Too few repeats to call",
} as const;

function Arm({ label, tally }: { label: string; tally: ExperimentArmTally }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">
        {tally.recommended} of {tally.answers} recommend
      </p>
      <p className="text-xs text-muted-foreground">
        {tally.named} name the brand
      </p>
    </div>
  );
}

function PromptRow({ item }: { item: ExperimentPromptResult }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="space-y-2 rounded-xl border bg-card p-4">
      <p className="font-medium">{item.prompt}</p>
      <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
        <Arm label="Original page (simulated)" tally={item.control} />
        <Arm label="Edited page (simulated)" tally={item.variant} />
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Saved real answers</p>
          <p className="text-sm font-medium">
            {item.real.read
              ? `${item.real.recommended} of ${item.real.read} recommend`
              : "None read yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            From collected runs, not from this replay
          </p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide simulated answers" : "Show simulated answers"}
      </Button>
      {open ? (
        <ul className="space-y-3 text-sm">
          {item.replays.map((r) => (
            <li key={r.id} className="space-y-1 rounded-lg border p-3">
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">
                  {r.arm === "control" ? "Original page" : "Edited page"} ·
                  repeat {r.repeat}
                </Badge>
                {r.named
                  ? `${r.stance ?? "not read"}${r.sentiment ? `, ${r.sentiment}` : ""}`
                  : "Brand not named"}
              </p>
              {r.evidence ? (
                <blockquote className="border-l-2 pl-3 italic text-muted-foreground">
                  “{r.evidence}”
                </blockquote>
              ) : null}
              <p className="whitespace-pre-wrap break-words">{r.answer}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ExperimentResults({
  experiment,
}: {
  experiment: PerceptionExperiment;
}) {
  const { verdict } = experiment;
  if (!verdict)
    return (
      <p className="text-sm text-muted-foreground">
        Not replayed yet. A replay hands a model each version of the page and
        reads how every answer treats {experiment.brand.name}.
      </p>
    );
  return (
    <section className="space-y-3">
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">Replay result</h3>
          <Badge>{CALL_LABEL[verdict.call]}</Badge>
          <Badge variant="outline">Experimental · simulated</Badge>
        </div>
        <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
          <div>
            <p className="text-xs text-muted-foreground">Original page</p>
            <p className="text-sm font-medium">
              {ofText(verdict.control)} ({pct(verdict.control.rate)})
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Edited page</p>
            <p className="text-sm font-medium">
              {ofText(verdict.variant)} ({pct(verdict.variant.rate)})
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Run-to-run spread</p>
            <p className="text-sm font-medium">
              {ofText(verdict.noise)} prompts unstable
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{verdict.explanation}</p>
        <p className="text-xs text-muted-foreground">
          {experiment.simulationNote} {verdict.repeats} repeats per prompt and
          version{experiment.model ? `, model ${experiment.model}` : ""}, cost $
          {experiment.costUsd.toFixed(3)}.
        </p>
      </div>
      <ul className="space-y-3">
        {experiment.promptResults.map((p) => (
          <PromptRow key={p.promptId} item={p} />
        ))}
      </ul>
    </section>
  );
}
