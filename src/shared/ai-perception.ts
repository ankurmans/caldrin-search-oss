// How an AI answer treats one brand. Stance (what the answer tells a buyer to
// do) is kept apart from sentiment (the tone toward the brand): a brand can be
// recommended with mixed sentiment, or described warmly and still not advised.
export const PERCEPTION_STANCES = [
  "recommended",
  "described",
  "discouraged",
] as const;
export const PERCEPTION_SENTIMENTS = [
  "positive",
  "neutral",
  "negative",
  "mixed",
] as const;
export const PERCEPTION_CONFIDENCES = ["high", "medium", "low"] as const;
// strength: something the answer credits the brand with. weakness: a flaw it
// states. objection: a reason it gives a buyer to hesitate or to check first.
export const PERCEPTION_POINT_KINDS = [
  "strength",
  "weakness",
  "objection",
] as const;
// The brand compared with a named competitor in the same answer.
export const PERCEPTION_COMPARISON_OUTCOMES = [
  "preferred",
  "equal",
  "not_preferred",
] as const;

export type PerceptionStance = (typeof PERCEPTION_STANCES)[number];
export type PerceptionSentiment = (typeof PERCEPTION_SENTIMENTS)[number];
export type PerceptionConfidence = (typeof PERCEPTION_CONFIDENCES)[number];
export type PerceptionPointKind = (typeof PERCEPTION_POINT_KINDS)[number];
export type PerceptionComparisonOutcome =
  (typeof PERCEPTION_COMPARISON_OUTCOMES)[number];

/**
 * Bump when the instructions or the schema the classifier follows change, so
 * a trend is only ever compared across answers read the same way.
 */
export const PERCEPTION_CLASSIFIER_VERSION = "perception-1";

/**
 * A ceiling for the model cost of reading one answer, about twice what a
 * 13-answer read of real answers cost ($0.015, or $0.0012 each). Shown before a
 * read; the real cost is recorded and reported after it.
 */
export const PERCEPTION_READ_ESTIMATE_USD = 0.0025;

/** What one answer amounts to for one brand, for counting and the heatmap. */
export const PERCEPTION_OUTCOMES = [
  "recommended",
  "neutral",
  "negative",
  "unread",
  "missing",
] as const;
export type PerceptionOutcome = (typeof PERCEPTION_OUTCOMES)[number];

export const PERCEPTION_OUTCOME_LABELS: Record<PerceptionOutcome, string> = {
  recommended: "Recommended",
  neutral: "Mentioned neutrally",
  negative: "Described negatively",
  unread: "Named, not read yet",
  missing: "Not named",
};

/**
 * A named brand counts as recommended when its stance is recommended, as
 * negative when it is discouraged or the tone is negative, and as neutral
 * otherwise. A brand that is not named is missing, whatever else the answer says.
 */
export function perceptionOutcome(
  mentioned: boolean,
  reading: { stance: PerceptionStance; sentiment: PerceptionSentiment } | null,
): PerceptionOutcome {
  if (!mentioned) return "missing";
  if (!reading) return "unread";
  if (reading.stance === "recommended") return "recommended";
  if (reading.stance === "discouraged" || reading.sentiment === "negative")
    return "negative";
  return "neutral";
}
