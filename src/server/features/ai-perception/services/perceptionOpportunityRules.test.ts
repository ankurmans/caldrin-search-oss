import { describe, expect, it } from "vitest";
import {
  perceptionOpportunities,
  type OpportunityAnswer,
  type OpportunityInput,
} from "./perceptionOpportunityRules";

const answer = (over: Partial<OpportunityAnswer>): OpportunityAnswer => ({
  observationId: "o",
  engine: "chatgpt",
  prompt: "Best tracker?",
  topic: "Tracking",
  outcome: "recommended",
  evidence: null,
  preferred: [],
  recommendedRivals: [],
  ...over,
});

const input = (answers: OpportunityAnswer[]): OpportunityInput => ({
  brand: "Caldrin",
  answers,
  themes: [],
  sources: [],
  contradictions: [],
  baseline: null,
  runs: 1,
});

describe("perceptionOpportunities", () => {
  it("counts each finding against every answer that tracks the brand", () => {
    const found = perceptionOpportunities(
      input([
        answer({ observationId: "a", preferred: ["Rival"] }),
        answer({ observationId: "b", preferred: ["Rival"] }),
        answer({ observationId: "c" }),
      ]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "competitor_preferred",
      answers: { numerator: 2, denominator: 3 },
      priority: "medium",
      confidence: "medium",
    });
  });

  it("flags absence only where a rival is recommended, and never rates it high on one answer", () => {
    const found = perceptionOpportunities(
      input([
        answer({ outcome: "missing", topic: "Reports" }),
        answer({
          outcome: "missing",
          topic: "Planning",
          recommendedRivals: ["Rival"],
        }),
      ]),
    );
    expect(found.map((f) => f.id)).toEqual([
      "absent_competitor_recommended:planning",
    ]);
    expect(found[0]).toMatchObject({ priority: "low", confidence: "low" });
  });

  it("ranks a negative reading above neutral ones", () => {
    const found = perceptionOpportunities(
      input([
        answer({ outcome: "neutral", topic: "A" }),
        answer({ outcome: "neutral", topic: "A" }),
        answer({ outcome: "negative", topic: "B" }),
      ]),
    );
    expect(found[0].id).toBe("named_not_recommended:b");
  });
});
