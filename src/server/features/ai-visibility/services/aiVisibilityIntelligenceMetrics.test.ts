import { describe, expect, it } from "vitest";
import {
  collectionTrend,
  computeBrands,
  intelCoverage,
  type IntelFact,
  type IntelMatch,
} from "./aiVisibilityIntelligenceMetrics";

const own = (over: Partial<IntelMatch> = {}): IntelMatch => ({
  name: "Demo",
  domain: "demo.example",
  own: true,
  mentioned: false,
  cited: false,
  recommended: null,
  firstMention: null,
  ...over,
});
const rival = (domain: string, over: Partial<IntelMatch> = {}): IntelMatch => ({
  ...own(),
  name: domain,
  domain,
  own: false,
  ...over,
});

let id = 0;
function fact(over: Partial<IntelFact>): IntelFact {
  id++;
  return {
    id: `o${id}`,
    runId: "r1",
    promptId: "p1",
    prompt: "Best coffee?",
    topic: "Coffee",
    intent: null,
    branded: false,
    engine: "chatgpt",
    status: "completed",
    hasAnswer: true,
    model: null,
    collectedAt: null,
    brands: [own()],
    ...over,
  };
}
const named = (firstMention = 0) => own({ mentioned: true, firstMention });
const brand = (facts: IntelFact[], domain = "demo.example", only = null) =>
  computeBrands(facts, only).find((b) => b.domain === domain)!;

describe("AI visibility", () => {
  it("averages engines with equal weight, unlike the pooled mention rate", () => {
    const facts = [
      ...Array.from({ length: 4 }, () => fact({ brands: [named()] })),
      fact({ engine: "gemini" }),
    ];
    const result = brand(facts);
    expect(result.visibility).toBe(0.5);
    expect(result.mention).toEqual({ numerator: 4, denominator: 5, rate: 0.8 });
    expect(result.byEngine.map((e) => [e.engine, e.visibility])).toEqual([
      ["chatgpt", 1],
      ["gemini", 0],
    ]);
  });

  it("averages per-prompt hit rates within an engine", () => {
    const facts = [
      fact({ promptId: "a", brands: [named()] }),
      fact({ promptId: "b" }),
      fact({ promptId: "b" }),
      fact({ promptId: "b" }),
    ];
    expect(brand(facts).visibility).toBe(0.5);
    expect(brand(facts).mention.rate).toBe(0.25);
  });

  it("leaves failed, empty and pending collections out of every rate and counts them", () => {
    const facts = [
      fact({ brands: [named()] }),
      fact({ status: "failed", hasAnswer: false }),
      fact({ hasAnswer: false }),
      fact({ status: "pending", hasAnswer: false }),
    ];
    expect(brand(facts).mention).toEqual({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
    expect(intelCoverage(facts)).toMatchObject({
      planned: 4,
      answered: 1,
      failed: 1,
      noAnswer: 1,
      pending: 1,
    });
  });

  it("counts a competitor only in answers where it was tracked", () => {
    const facts = [
      fact({ brands: [own(), rival("late.example", { mentioned: true })] }),
      fact({ brands: [own()] }),
      fact({ brands: [own()] }),
    ];
    expect(brand(facts, "late.example").mention).toEqual({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
  });
});

describe("sentiment", () => {
  it("counts labels over classified mentions only, and stays null with none", () => {
    const labeled = (sentiment: IntelMatch["sentiment"]) =>
      fact({ brands: [{ ...named(), sentiment }] });
    expect(brand([fact({ brands: [named()] })]).sentiment).toBeNull();
    expect(
      brand([
        labeled("positive"),
        labeled("positive"),
        labeled("negative"),
        fact({ brands: [named()] }),
      ]).sentiment,
    ).toEqual({
      classified: 3,
      mentioned: 4,
      positive: 2,
      neutral: 0,
      negative: 1,
      mixed: 0,
    });
  });
});

describe("leaderboard metrics", () => {
  it("returns null, never 0%, for rates over answers that never name the brand", () => {
    const result = brand([fact({ brands: [own({ cited: true })] })]);
    expect(result.citationAmongMentioned.rate).toBeNull();
    expect(result.recommendation.rate).toBeNull();
    expect(result.avgPosition).toEqual({ value: null, answers: 0 });
    // Cited without being named still counts among all answers.
    expect(result.citedAnswers.rate).toBe(1);
  });

  it("separates citations among mentioned answers from recommendations", () => {
    const facts = [
      fact({
        brands: [own({ mentioned: true, cited: true, firstMention: 0 })],
      }),
      fact({
        brands: [own({ mentioned: true, recommended: true, firstMention: 0 })],
      }),
      fact({
        brands: [own({ mentioned: true, recommended: false, firstMention: 0 })],
      }),
      fact({ brands: [own()] }),
    ];
    const result = brand(facts);
    expect(result.citationAmongMentioned).toEqual({
      numerator: 1,
      denominator: 3,
      rate: 1 / 3,
    });
    expect(result.recommendation.numerator).toBe(1);
    expect(result.recommendation.denominator).toBe(3);
    expect(result.notRecommended).toBe(1);
  });

  it("works out share of voice and position over the compared brands only", () => {
    const facts = [
      fact({
        brands: [
          named(40),
          rival("a.example", { mentioned: true, firstMention: 10 }),
          rival("b.example", { mentioned: true, firstMention: 0 }),
        ],
      }),
    ];
    expect(brand(facts).shareOfVoice).toEqual({
      numerator: 1,
      denominator: 3,
      rate: 1 / 3,
    });
    expect(brand(facts).avgPosition.value).toBe(3);

    const narrowed = computeBrands(facts, ["a.example"]);
    expect(new Set(narrowed.map((b) => b.domain))).toEqual(
      new Set(["a.example", "demo.example"]),
    );
    const mine = narrowed.find((b) => b.own)!;
    expect(mine.shareOfVoice.denominator).toBe(2);
    expect(mine.avgPosition.value).toBe(2);
  });

  it("ranks by visibility with ties sharing a rank", () => {
    const facts = [
      fact({
        brands: [
          named(),
          rival("a.example", { mentioned: true }),
          rival("b.example"),
        ],
      }),
    ];
    const ranks = Object.fromEntries(
      computeBrands(facts, null).map((b) => [b.domain, b.rank]),
    );
    expect(ranks).toEqual({
      "demo.example": 1,
      "a.example": 1,
      "b.example": 3,
    });
  });
});

const run = (runId: string, createdAt: string, promptSetVersionId = "v1") => ({
  id: runId,
  createdAt,
  promptSetVersionId,
});

describe("collection-day trend", () => {
  it("pools runs of one prompt set per UTC day and never merges prompt sets", () => {
    const runs = [
      run("r1", "2026-10-01T04:00:00.000Z"),
      run("r2", "2026-10-01T18:00:00.000Z"),
      run("r3", "2026-10-01T09:00:00.000Z", "v2"),
      run("r4", "2026-10-02T04:00:00.000Z"),
    ];
    const facts = [
      fact({ runId: "r1", brands: [named()] }),
      fact({ runId: "r1", engine: "gemini" }),
      fact({ runId: "r2", brands: [named()] }),
      fact({ runId: "r2", engine: "gemini", status: "failed" }),
      fact({ runId: "r3", promptId: "p2", brands: [named()] }),
      fact({ runId: "r4" }),
    ];

    const points = collectionTrend(runs, facts, "demo.example");

    expect(points.map((p) => [p.date, p.promptSetVersionId, p.runs])).toEqual([
      ["2026-10-01", "v1", 2],
      ["2026-10-01", "v2", 1],
      ["2026-10-02", "v1", 1],
    ]);
    // chatgpt 2 of 2, gemini 0 of 1: engines weigh equally, the pooled
    // mention rate does not; the failed collection is in neither.
    expect(points[0]).toMatchObject({
      visibility: 0.5,
      mention: { numerator: 2, denominator: 3 },
      prompts: 1,
      engines: ["chatgpt", "gemini"],
    });
    expect(points[2].mention).toEqual({
      numerator: 0,
      denominator: 1,
      rate: 0,
    });
  });
});
