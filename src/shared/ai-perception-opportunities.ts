import type { IntelRate } from "./ai-visibility-intelligence";
import type { AiEngine } from "./ai-visibility";
import type { PerceptionPopulation } from "./ai-perception-view";
import type { OpportunityAction } from "@/server/features/content/rules/opportunityRules";

const PERCEPTION_OPPORTUNITY_KINDS = [
  "competitor_preferred",
  "named_not_recommended",
  "absent_competitor_recommended",
  "recurring_objection",
  "unfavourable_source",
  "contradicted_fact",
] as const;
export type PerceptionOpportunityKind =
  (typeof PERCEPTION_OPPORTUNITY_KINDS)[number];

export const PERCEPTION_OPPORTUNITY_LABELS: Record<
  PerceptionOpportunityKind,
  string
> = {
  competitor_preferred: "Competitor preferred",
  named_not_recommended: "Named, not recommended",
  absent_competitor_recommended: "Absent where a competitor is recommended",
  recurring_objection: "Recurring objection",
  unfavourable_source: "Source beside unfavourable answers",
  contradicted_fact: "Answer contradicts a fact you set",
};

/** Where the work goes: a page, outreach, or a person's decision. */
export type PerceptionOpportunityRoute =
  | "content_studio"
  | "link_acquisition"
  | "human_decision";

export interface PerceptionOpportunityEvidence {
  observationId: string;
  engine: AiEngine;
  prompt: string;
  quote: string | null;
  note: string;
}

export interface PerceptionOpportunity {
  /** Stable for the same finding, so saving it twice updates one opportunity. */
  id: string;
  kind: PerceptionOpportunityKind;
  title: string;
  /** Answers affected over the answers that track the brand. */
  answers: IntelRate;
  priority: "high" | "medium" | "low";
  /** From how many answers and runs support it; never a forecast. */
  confidence: "high" | "medium" | "low";
  /** What the saved answers show, counted. */
  observed: string;
  /** What is suggested from that, a hypothesis to test and not a finding. */
  inferred: string;
  buyerQuestions: string[];
  evidence: PerceptionOpportunityEvidence[];
  route: PerceptionOpportunityRoute;
  effort: "low" | "medium" | "high";
  /** The Opportunities action it becomes when saved. */
  action: OpportunityAction;
}

export interface AiPerceptionOpportunities {
  population: PerceptionPopulation;
  brand: { name: string; domain: string } | null;
  opportunities: PerceptionOpportunity[];
  notes: string[];
}
