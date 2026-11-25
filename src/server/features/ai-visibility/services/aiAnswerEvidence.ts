import { sort } from "remeda";
import type {
  AiAnswerMention,
  AiBrandSentiment,
  AiCitedTextSpan,
  AiTextSpan,
} from "@/shared/ai-answer-evidence";
import {
  aiBrandLabel,
  type AiBrandResult,
  type AiSource,
} from "@/shared/ai-visibility";
import { aiBrandNames, aiMentionSpans } from "./aiVisibilityMatching";
import { recommendationEvidence } from "./aiVisibilityRecommendation";

type Brand = AiBrandResult & {
  recommended: boolean | null;
  sentiment?: AiBrandSentiment["label"] | null;
  sentimentModel?: string | null;
  sentimentClassifiedAt?: string | null;
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every literal, case-insensitive occurrence of a cited URL or domain. */
function citedTextSpans(text: string, sources: AiSource[]): AiCitedTextSpan[] {
  const found = new Map<string, AiCitedTextSpan>();
  for (const source of sources) {
    const domain = source.domain.toLowerCase();
    const needles = new Set([source.url, domain, domain.replace(/^www\./, "")]);
    for (const needle of needles) {
      if (needle.length < 4) continue;
      // A domain must not run on into a longer host ("acme.com.evil.io"); a
      // URL must not run on into a longer path.
      const after = needle === source.url ? "/" : "";
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}_.-])${escape(needle)}(?![\\p{L}\\p{N}_${after}-]|\\.[\\p{L}\\p{N}])`,
        "giu",
      );
      for (const match of text.matchAll(pattern)) {
        const key = `${match.index}:${match.index + match[0].length}`;
        const span = found.get(key) ?? {
          start: match.index,
          end: match.index + match[0].length,
          domain: source.domain,
          positions: [],
        };
        if (!span.positions.includes(source.position))
          span.positions.push(source.position);
        found.set(key, span);
      }
    }
  }
  // A domain inside a written-out URL is shown as part of that URL.
  const spans = sort([...found.values()], (a, b) => a.start - b.start);
  return spans.filter(
    (span) =>
      !spans.some(
        (other) =>
          other !== span &&
          other.start <= span.start &&
          other.end >= span.end &&
          other.end - other.start > span.end - span.start,
      ),
  );
}

const overlaps = (a: AiTextSpan, b: AiTextSpan) =>
  a.start < b.end && b.start < a.end;

/**
 * Highlights and caveats for one open answer, worked out from its saved text.
 * `text` is the full plain text; spans past `limit` are dropped with the text.
 */
export function answerEvidence(
  text: string,
  limit: number,
  brands: Brand[],
  sources: AiSource[],
) {
  const shown = <T extends AiTextSpan>(spans: T[]) =>
    spans.filter((span) => span.end <= limit);
  const ambiguities: string[] = [];
  const noVerdict: string[] = [];
  const matched: { label: string; spans: AiTextSpan[] }[] = [];
  const mentions: AiAnswerMention[] = [];
  for (const brand of brands.filter((b) => b.mentioned)) {
    const label = aiBrandLabel(brand);
    const names = aiBrandNames(brand);
    const all = aiMentionSpans(text, names);
    const spans = shown(all);
    const recommendation = recommendationEvidence(text, all);
    const verdicts = new Set(recommendation.phrases.map((p) => p.verdict));
    mentions.push({
      domain: brand.domain,
      spans,
      recommended: brand.recommended,
      recommendationSpans: shown(recommendation.phrases),
      sentiment:
        brand.sentiment && brand.sentimentModel && brand.sentimentClassifiedAt
          ? {
              label: brand.sentiment,
              model: brand.sentimentModel,
              classifiedAt: brand.sentimentClassifiedAt,
            }
          : null,
    });
    matched.push({ label, spans });
    if (!all.length)
      ambiguities.push(
        `${label} is marked as mentioned, but its name was not found again in this text.`,
      );
    else if (!spans.length)
      ambiguities.push(
        `${label} is only mentioned in the part of the answer cut off here.`,
      );
    // aiBrandNames adds a third, domain-stem alias only for domain-named brands.
    const stem = names[2]?.toLowerCase();
    if (
      stem &&
      all.length &&
      all.every((s) => text.slice(s.start, s.end).toLowerCase() === stem)
    )
      ambiguities.push(
        `${label} is matched only by the word “${names[2]}” from ${brand.domain}, which can also mean something else.`,
      );
    if (verdicts.size > 1)
      ambiguities.push(
        `${label} gets both a positive and a negative verdict in this answer, so no verdict is recorded.`,
      );
    else if (all.length && !verdicts.size) noVerdict.push(label);
    if (brand.recommended !== recommendation.verdict)
      ambiguities.push(
        `The saved verdict for ${label} differs from re-reading this text, likely because matching rules changed after collection. The saved verdict is shown.`,
      );
  }
  const shared = new Set<string>();
  for (const [index, a] of matched.entries())
    for (const b of matched.slice(index + 1))
      for (const span of a.spans)
        for (const other of b.spans.filter((o) => overlaps(span, o))) {
          const words = text.slice(
            Math.min(span.start, other.start),
            Math.max(span.end, other.end),
          );
          shared.add(
            `“${words}” is matched by both ${a.label} and ${b.label}.`,
          );
        }
  ambiguities.push(...shared);
  if (noVerdict.length)
    ambiguities.push(
      `No explicit recommendation wording was found for ${noVerdict.join(", ")}. The check looks for a few fixed phrases such as “I recommend” or “is the best choice”, so this does not mean “not recommended”.`,
    );
  return {
    mentions,
    citedTextSpans: shown(citedTextSpans(text, sources)),
    ambiguities,
  };
}
