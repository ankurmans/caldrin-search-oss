import { sort, unique } from "remeda";
import type { PerceptionPointKind } from "@/shared/ai-perception";
import type { PerceptionTheme } from "@/shared/ai-perception-sources";
import type { AiEngine } from "@/shared/ai-visibility";

export interface ThemePoint {
  observationId: string;
  promptId: string;
  engine: AiEngine;
  kind: PerceptionPointKind;
  text: string;
  quote: string;
}

const STOP = new Set(
  "a an and are as at be but by for from has have in is it its not of on or that the their they this to with can may often too very more less than into about".split(
    " ",
  ),
);

/** Lower-cased content words with a light stem, so "pricing" and "prices" meet. */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );
}

function overlap(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared || 1);
}

const SAME_THEME = 0.5;

/**
 * Groups points that say much the same thing, by word overlap, within one kind.
 * It is a grouping aid, not a judgement: each theme keeps the exact words from
 * every answer, and a point never joins a theme of another kind.
 */
export function groupThemes(
  points: ThemePoint[],
  readMentions: number,
  promptsByObservation: Map<string, string>,
): PerceptionTheme[] {
  const clusters: {
    kind: PerceptionPointKind;
    seed: Set<string>;
    points: ThemePoint[];
  }[] = [];
  for (const point of points) {
    const t = tokens(point.text);
    const home = clusters.find(
      (c) => c.kind === point.kind && overlap(c.seed, t) >= SAME_THEME,
    );
    if (home) home.points.push(point);
    else clusters.push({ kind: point.kind, seed: t, points: [point] });
  }
  return sort(
    clusters.map((c) => {
      const answers = unique(c.points.map((p) => p.observationId));
      const counts = new Map<string, number>();
      for (const p of c.points)
        counts.set(p.text, (counts.get(p.text) ?? 0) + 1);
      const label = sort(
        [...counts.entries()],
        (a, b) => b[1] - a[1] || a[0].length - b[0].length,
      )[0][0];
      const first = new Map(c.points.map((p) => [p.observationId, p]));
      return {
        id: `${c.kind}:${sort([...c.seed], (a, b) => a.localeCompare(b)).join("-")}`,
        kind: c.kind,
        label,
        answers: {
          numerator: answers.length,
          denominator: readMentions,
          rate: readMentions ? answers.length / readMentions : null,
        },
        engines: unique(c.points.map((p) => p.engine)),
        prompts: unique(answers.map((id) => promptsByObservation.get(id) ?? id))
          .length,
        examples: [...first.values()].slice(0, 3).map((p) => ({
          observationId: p.observationId,
          engine: p.engine,
          text: p.text,
          quote: p.quote,
        })),
      };
    }),
    (a, b) =>
      b.answers.numerator - a.answers.numerator ||
      a.label.localeCompare(b.label),
  );
}
