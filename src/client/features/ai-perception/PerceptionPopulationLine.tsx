import { AI_ENGINE_LABELS } from "@/shared/ai-visibility";
import type { AiPerceptionView } from "@/shared/ai-perception-view";
import { shortDate } from "@/client/features/ai-visibility/insights/insightsShared";

/** The population every figure below covers, so it can be checked by hand. */
export function PerceptionPopulationLine({ view }: { view: AiPerceptionView }) {
  const p = view.population;
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4 text-sm">
      <p>
        <span className="font-medium">{p.answered}</span> answers with text from{" "}
        <span className="font-medium">{p.prompts}</span> prompts across{" "}
        {p.engines.length
          ? p.engines.map((e) => AI_ENGINE_LABELS[e]).join(", ")
          : "no engines"}
        , {shortDate(p.window.start)} to {shortDate(p.window.end)} ({p.runs}{" "}
        {p.runs === 1 ? "run" : "runs"}).
      </p>
      <p className="text-muted-foreground">
        {p.missing
          ? `${p.missing} of ${p.planned} planned collections have no usable answer and count as missing, not as a perception. `
          : ""}
        {p.repeatRuns.note} Read by classifier {p.classifierVersion}; a brand an
        answer does not name is never given a perception.
      </p>
      {view.warnings.map((w) => (
        <p key={w} className="text-amber-700 dark:text-amber-300">
          {w}
        </p>
      ))}
    </section>
  );
}
