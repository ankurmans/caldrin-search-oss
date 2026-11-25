import { useState } from "react";
import { Badge } from "@/client/components/ui/badge";
import { pct } from "@/client/features/ai-visibility/insights/insightsShared";
import type { InsightsFilters } from "@/client/features/ai-visibility/insights/insightsShared";
import type {
  AiPerceptionView,
  PerceptionHeatmapCell,
} from "@/shared/ai-perception-view";
import { AI_PROMPT_INTENT_LABELS } from "@/shared/ai-prompt-intent";
import { PerceptionCellSheet, type CellTarget } from "./PerceptionCellSheet";
import { OutcomeBar, OutcomeLegend } from "./perceptionShared";

function Cell({
  cell,
  onOpen,
}: {
  cell: PerceptionHeatmapCell | undefined;
  onOpen: () => void;
}) {
  if (!cell || !cell.answers) {
    return <span className="text-xs text-muted-foreground">No answers</span>;
  }
  const read =
    cell.counts.recommended + cell.counts.neutral + cell.counts.negative;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full min-w-28 space-y-1 rounded-md p-1.5 text-left hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={`${cell.counts.recommended} recommended, ${cell.counts.neutral} neutral, ${cell.counts.negative} negative, ${cell.counts.unread} unread, ${cell.counts.missing} not named, of ${cell.answers} answers`}
    >
      <OutcomeBar counts={cell.counts} className="h-3" />
      <span className="block text-xs tabular-nums text-muted-foreground">
        {read
          ? `${pct(cell.counts.recommended / read)} rec. · ${cell.counts.recommended}/${read} read`
          : `${cell.counts.missing}/${cell.answers} not named`}
      </span>
    </button>
  );
}

export function PerceptionHeatmap({
  projectId,
  filters,
  view,
}: {
  projectId: string;
  filters: InsightsFilters;
  view: AiPerceptionView;
}) {
  const [mode, setMode] = useState<"topic" | "prompt">("topic");
  const [target, setTarget] = useState<CellTarget | null>(null);
  if (!view.brands.length) return null;
  const rows =
    mode === "topic"
      ? view.topics.map((t) => ({
          key: `topic:${t.topic}`,
          title: t.topic,
          subtitle: `${t.prompts} ${t.prompts === 1 ? "prompt" : "prompts"}`,
          cells: t.cells,
          scope: { topic: t.topic } as const,
        }))
      : view.heatmap.map((r) => ({
          key: r.promptId,
          title: r.prompt,
          subtitle: [
            r.topic,
            r.intent ? AI_PROMPT_INTENT_LABELS[r.intent] : null,
          ]
            .filter(Boolean)
            .join(" · "),
          cells: r.cells,
          scope: { promptId: r.promptId } as const,
        }));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">
          Perception by {mode === "topic" ? "topic" : "prompt"} and brand
        </h2>
        <div className="flex gap-1" role="group" aria-label="Group rows by">
          {(["topic", "prompt"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-md border px-3 py-1.5 text-sm ${mode === m ? "bg-muted font-medium" : "text-muted-foreground"}`}
            >
              By {m}
            </button>
          ))}
        </div>
      </div>
      <OutcomeLegend />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="sticky left-0 bg-card p-3 font-medium">
                {mode === "topic" ? "Topic" : "Prompt"}
              </th>
              {view.brands.map((b) => (
                <th key={b.domain} className="p-3 font-medium">
                  <span className="flex items-center gap-1.5">
                    {b.name}
                    {b.own ? <Badge variant="secondary">You</Badge> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b last:border-0 align-top">
                <th
                  scope="row"
                  className="sticky left-0 max-w-64 bg-card p-3 text-left font-normal"
                >
                  <span className="line-clamp-3 font-medium">{row.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.subtitle}
                  </span>
                </th>
                {view.brands.map((b) => (
                  <td key={b.domain} className="p-2">
                    <Cell
                      cell={row.cells.find((c) => c.domain === b.domain)}
                      onOpen={() =>
                        setTarget({
                          domain: b.domain,
                          name: b.name,
                          title: row.title,
                          ...row.scope,
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Each bar is the answers behind the cell, split by what they say about
        the brand. Open a cell to read those answers and correct a reading.
      </p>
      <PerceptionCellSheet
        projectId={projectId}
        filters={filters}
        target={target}
        onClose={() => setTarget(null)}
      />
    </section>
  );
}
