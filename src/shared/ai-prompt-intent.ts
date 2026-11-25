/**
 * The buyer intent a tracked prompt stands for. It is set by people, never
 * guessed: a prompt without one has an unknown intent.
 */
export const AI_PROMPT_INTENTS = [
  "informational",
  "category_discovery",
  "recommendation",
  "comparison",
  "alternatives",
  "trust_validation",
  "branded",
] as const;

export type AiPromptIntent = (typeof AI_PROMPT_INTENTS)[number];

export const AI_PROMPT_INTENT_LABELS: Record<AiPromptIntent, string> = {
  informational: "Informational",
  category_discovery: "Category discovery",
  recommendation: "Recommendation",
  comparison: "Comparison",
  alternatives: "Alternatives",
  trust_validation: "Trust validation",
  branded: "Branded",
};

/** Filter value for prompts with no intent set. */
export const AI_UNKNOWN_INTENT = "unknown";
