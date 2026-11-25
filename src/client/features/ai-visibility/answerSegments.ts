import { sort } from "remeda";
import type { AiTextSpan } from "@/shared/ai-answer-evidence";
import { aiBrandLabel, type AiAnswer } from "@/shared/ai-visibility";

export type AnswerMark =
  | { kind: "mention"; domain: string; label: string; own: boolean }
  | { kind: "recommendation"; label: string; verdict: boolean }
  | { kind: "cited"; domain: string; positions: number[] };

type AnswerHighlight = AiTextSpan & { mark: AnswerMark };

interface AnswerSegment {
  text: string;
  marks: AnswerMark[];
}

/** Every highlight the server found in answerText, as one flat list. */
export function answerHighlights(answer: AiAnswer): AnswerHighlight[] {
  const brands = new Map(answer.observation.brands.map((b) => [b.domain, b]));
  return [
    ...answer.mentions.flatMap((mention) => {
      const brand = brands.get(mention.domain);
      const label = brand ? aiBrandLabel(brand) : mention.domain;
      return [
        ...mention.spans.map((span) => ({
          ...span,
          mark: {
            kind: "mention" as const,
            domain: mention.domain,
            label,
            own: !!brand?.own,
          },
        })),
        ...mention.recommendationSpans.map(({ start, end, verdict }) => ({
          start,
          end,
          mark: { kind: "recommendation" as const, label, verdict },
        })),
      ];
    }),
    ...answer.citedTextSpans.map(({ start, end, domain, positions }) => ({
      start,
      end,
      mark: { kind: "cited" as const, domain, positions },
    })),
  ];
}

/**
 * Splits text at every highlight edge so overlapping highlights become
 * non-overlapping segments, each carrying every mark that covers it. The
 * segments' text joined back together is exactly `text`.
 */
export function segmentAnswer(
  text: string,
  highlights: AnswerHighlight[],
): AnswerSegment[] {
  const valid = highlights
    .map((h) => ({
      ...h,
      start: Math.max(0, h.start),
      end: Math.min(text.length, h.end),
    }))
    .filter((h) => h.start < h.end);
  const edges = sort(
    [...new Set([0, text.length, ...valid.flatMap((h) => [h.start, h.end])])],
    (a, b) => a - b,
  );
  const segments: AnswerSegment[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const [start, end] = [edges[i], edges[i + 1]];
    segments.push({
      text: text.slice(start, end),
      marks: valid
        .filter((h) => h.start <= start && h.end >= end)
        .map((h) => h.mark),
    });
  }
  return segments;
}

const OWN_CLASS = "bg-primary/45 dark:bg-primary/25";
// Restrained tints that stay legible on both themes; stable by brand order.
const COMPETITOR_CLASSES = [
  "bg-sky-500/20",
  "bg-teal-500/20",
  "bg-violet-500/20",
  "bg-rose-500/20",
  "bg-slate-500/25",
];
export const POSITIVE_CLASS =
  "underline decoration-success decoration-2 underline-offset-2";
export const NEGATIVE_CLASS =
  "underline decoration-destructive decoration-wavy decoration-2 underline-offset-2";
export const CITED_CLASS = "border-b-2 border-dotted border-info";

/** Highlight color of each brand, by domain: yours, then competitors in order. */
export function brandHighlightClasses(answer: AiAnswer) {
  const classes = new Map<string, string>();
  let competitor = 0;
  for (const brand of answer.observation.brands)
    classes.set(
      brand.domain,
      brand.own
        ? OWN_CLASS
        : COMPETITOR_CLASSES[competitor++ % COMPETITOR_CLASSES.length],
    );
  return classes;
}
