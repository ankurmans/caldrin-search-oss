import { useMemo } from "react";
import { aiBrandLabel, type AiAnswer } from "@/shared/ai-visibility";
import { EngineLabel } from "./EngineLabel";
import { AnswerEntities, AnswerSources } from "./AnswerEvidenceLists";
import {
  answerHighlights,
  brandHighlightClasses,
  CITED_CLASS,
  NEGATIVE_CLASS,
  POSITIVE_CLASS,
  segmentAnswer,
  type AnswerMark,
} from "./answerSegments";

/*
 * The answer is untrusted model output. It is only ever rendered as React text
 * children, so markup in it shows as literal text and never runs.
 */

function markTitle(mark: AnswerMark) {
  if (mark.kind === "mention")
    return `Mention of ${mark.label}${mark.own ? " (you)" : ""}`;
  if (mark.kind === "recommendation")
    return `${mark.verdict ? "Recommendation" : "Recommendation against"} wording for ${mark.label}`;
  return `Cited source ${mark.positions.map((p) => `[${p}]`).join(", ")}: ${mark.domain}`;
}

function markClasses(marks: AnswerMark[], brands: Map<string, string>) {
  const mentions = marks.filter((m) => m.kind === "mention");
  return [
    "rounded-sm text-foreground",
    mentions.length ? brands.get(mentions[0].domain) : "bg-transparent",
    // Two brands matching the same words: flag it on top of the first color.
    mentions.length > 1 &&
      "outline outline-1 outline-dashed outline-foreground/50",
    marks.some((m) => m.kind === "recommendation" && m.verdict) &&
      POSITIVE_CLASS,
    marks.some((m) => m.kind === "recommendation" && !m.verdict) &&
      NEGATIVE_CLASS,
    marks.some((m) => m.kind === "cited") && CITED_CLASS,
  ]
    .filter(Boolean)
    .join(" ");
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className={`inline-block rounded-sm px-1 ${className}`}>Aa</span>
      {label}
    </li>
  );
}

function AnswerLegend({ answer }: { answer: AiAnswer }) {
  const classes = brandHighlightClasses(answer);
  const mentioned = new Set(answer.mentions.map((m) => m.domain));
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
      aria-label="Highlight legend"
    >
      {answer.observation.brands
        .filter((brand) => mentioned.has(brand.domain))
        .map((brand) => (
          <Swatch
            key={brand.domain}
            className={classes.get(brand.domain) ?? ""}
            label={
              brand.own ? `You (${aiBrandLabel(brand)})` : aiBrandLabel(brand)
            }
          />
        ))}
      <Swatch className={POSITIVE_CLASS} label="Recommends" />
      <Swatch className={NEGATIVE_CLASS} label="Recommends against" />
      <Swatch className={CITED_CLASS} label="Cited source named" />
    </ul>
  );
}

/** The answer's plain text with brand, verdict and citation highlights. */
export function HighlightedAnswerText({ answer }: { answer: AiAnswer }) {
  const text = answer.answerText ?? "";
  const segments = useMemo(
    () => segmentAnswer(text, answerHighlights(answer)),
    [answer, text],
  );
  const classes = useMemo(() => brandHighlightClasses(answer), [answer]);
  if (!text)
    return (
      <p className="text-sm text-muted-foreground">
        No answer text was captured.
      </p>
    );
  return (
    <div className="space-y-3">
      <AnswerLegend answer={answer} />
      <p
        className="whitespace-pre-wrap break-words text-sm leading-7"
        data-ph-mask
      >
        {segments.map((segment, index) =>
          segment.marks.length ? (
            <mark
              // Segments never move, so their order is a stable key.
              key={index}
              className={markClasses(segment.marks, classes)}
              title={segment.marks.map(markTitle).join("; ")}
              aria-description={segment.marks.map(markTitle).join("; ")}
            >
              {segment.text}
            </mark>
          ) : (
            segment.text
          ),
        )}
      </p>
    </div>
  );
}

function formatTime(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

/** Where this answer came from: prompt, engine, model, time and run. */
export function AnswerFacts({ answer }: { answer: AiAnswer }) {
  const { observation } = answer;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
      <dt className="text-muted-foreground">Prompt</dt>
      <dd className="font-medium break-words" data-ph-mask>
        {observation.prompt}
      </dd>
      <dt className="text-muted-foreground">Engine</dt>
      <dd>
        <EngineLabel engine={observation.engine} />
      </dd>
      <dt className="text-muted-foreground">Model</dt>
      <dd className="break-words">
        {answer.model ?? (
          <span className="text-muted-foreground">Model not reported</span>
        )}
      </dd>
      <dt className="text-muted-foreground">Collected</dt>
      <dd>{formatTime(observation.collectedAt)}</dd>
      <dt className="text-muted-foreground">Run</dt>
      <dd>#{answer.runNumber}</dd>
    </dl>
  );
}

/** Caveats about how brands and verdicts were matched in this answer. */
export function AnswerAmbiguities({ answer }: { answer: AiAnswer }) {
  if (!answer.ambiguities.length) return null;
  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
      <h3 className="font-medium text-foreground">Matching notes</h3>
      <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
        {answer.ambiguities.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}

/** The whole evidence view for one answer, stacked for a narrow sheet. */
export function HighlightedAnswer({ answer }: { answer: AiAnswer }) {
  return (
    <div className="space-y-5">
      <AnswerFacts answer={answer} />
      <HighlightedAnswerText answer={answer} />
      <AnswerAmbiguities answer={answer} />
      <section className="space-y-3" aria-label="Cited sources">
        <h3 className="text-sm font-medium">
          Cited sources ({answer.sources.length})
        </h3>
        <AnswerSources answer={answer} />
      </section>
      <section className="space-y-3" aria-label="Detected entities">
        <h3 className="text-sm font-medium">Detected entities</h3>
        <AnswerEntities answer={answer} />
      </section>
    </div>
  );
}
