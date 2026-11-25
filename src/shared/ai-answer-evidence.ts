// Highlight evidence for one AI answer; see AiAnswer in ./ai-visibility.

/** A [start, end) character range in AiAnswer.answerText. */
export interface AiTextSpan {
  start: number;
  end: number;
}
/** Explicit verdict wording, e.g. "I'd recommend" or "is not recommended". */
export interface AiRecommendationSpan extends AiTextSpan {
  verdict: boolean;
}
/** Where a cited page's URL or domain is written out in the answer text. */
export interface AiCitedTextSpan extends AiTextSpan {
  domain: string;
  /** Positions (AiSource.position) of the cited pages this text names. */
  positions: number[];
}
export interface AiBrandSentiment {
  label: "positive" | "neutral" | "negative" | "mixed";
  model: string;
  classifiedAt: string;
}
export interface AiAnswerMention {
  domain: string;
  spans: AiTextSpan[];
  /** The saved verdict: true or false only when explicit wording was found. */
  recommended: boolean | null;
  /** The wording behind a verdict, found again in the saved answer text. */
  recommendationSpans: AiRecommendationSpan[];
  /** Always null for now: Phase 2 fills it from a stored classification. */
  sentiment: AiBrandSentiment | null;
}
