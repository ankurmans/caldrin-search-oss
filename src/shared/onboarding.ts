export const ONBOARDING_GOALS = [
  "tracking",
  "content",
  "links",
  "agent",
] as const;
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number];
export type OnboardingPreference = OnboardingGoal | "skipped" | null;

export const ONBOARDING_GOAL_LABELS: Record<OnboardingGoal, string> = {
  tracking: "Track rankings and AI answers",
  content: "Write content",
  links: "Build links",
  agent: "Work from my AI agent",
};
