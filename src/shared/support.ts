export const SUPPORT_EMAIL = "support@caldrin.co";

export const FEEDBACK_KINDS = ["feature", "improvement", "problem"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  feature: "New feature",
  improvement: "Improvement",
  problem: "Something is wrong",
};

export const FEEDBACK_MAX_CHARS = 4000;
