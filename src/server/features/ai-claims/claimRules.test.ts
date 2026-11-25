import { describe, expect, it } from "vitest";
import {
  compareApprovedFacts,
  modelClaims,
  validateClaims,
} from "./claimRules";

const proposition = {
  subject: "Example Recorder",
  predicate: "monthly price",
  value: "USD 20 / month",
  polarity: "asserts" as const,
  plan: "Standard",
  market: "US",
  product: null,
  version: null,
  condition: null,
  effectiveDate: null,
};

describe("saved claim evidence", () => {
  it("keeps exact offsets and reports ambiguous or invented quotes", () => {
    const quote = "Standard costs USD 20 per month.";
    const answer = `Example Recorder 🎙️. ${quote} Other context.`;
    const result = validateClaims(
      "Example Recorder",
      answer,
      modelClaims.parse({
        ambiguous: 1,
        claims: [
          { ...proposition, quote, category: "pricing", confidence: 0.9 },
          {
            ...proposition,
            quote: "The answer never said this",
            category: "pricing",
            confidence: 0.95,
          },
        ],
      }),
    );
    expect(result.needsReview).toBe(2);
    expect(result.claims).toHaveLength(1);
    const claim = result.claims[0];
    expect(answer.slice(claim.start, claim.end)).toBe(quote);
  });

  it("keeps negation, dates, plans, conditions, and currencies out of exact merges", () => {
    const changes = [
      { polarity: "denies" as const },
      { effectiveDate: "2026-03-01" },
      { plan: "Agency" },
      { condition: "Annual billing only" },
      { value: "EUR 20 / month" },
    ];
    const all = [{}, ...changes].map((change, index) => ({
      ...proposition,
      ...change,
      quote: `Recorded statement number ${index}.`,
      category: "pricing" as const,
      confidence: 0.85,
    }));
    const result = validateClaims(
      "Example Recorder",
      `Example Recorder: ${all.map((row) => row.quote).join(" ")}`,
      {
        claims: all,
        ambiguous: 0,
      },
    );
    expect(new Set(result.claims.map((row) => row.key)).size).toBe(all.length);
  });

  it("compares scoped prices within the same currency and period", () => {
    const approved = {
      ...proposition,
      id: "a",
      effectiveFrom: "2026-10-01",
      effectiveUntil: null,
    };
    expect(
      compareApprovedFacts(
        { ...proposition, value: "USD 30 / month" },
        "2026-11-23",
        [approved],
      ).status,
    ).toBe("conflict");
    expect(
      compareApprovedFacts(
        { ...proposition, value: "EUR 30 / month" },
        "2026-11-23",
        [approved],
      ).status,
    ).toBe("insufficient");
  });

  it.each([
    ["USD 30 per month for Standard plan", "conflict"],
    ["USD 20 per month", "consistent"],
    ["USD 30 per month for Premium plan", "insufficient"],
    ["USD 30 per year", "insufficient"],
  ])("compares the provider's recurring price format %s", (value, outcome) => {
    const approved = {
      ...proposition,
      value: "USD 20 per month",
      id: "approved",
      effectiveFrom: "2026-10-01",
      effectiveUntil: null,
    };
    expect(
      compareApprovedFacts({ ...proposition, value }, "2026-11-23", [approved])
        .status,
    ).toBe(outcome);
  });

  it.each([
    ["monthly price of Standard plan", "conflict"],
    ["monthly price of the Standard plan", "conflict"],
    ["monthly price of Premium plan", "insufficient"],
  ])(
    "compares a price predicate with a redundant plan qualifier: %s",
    (predicate, outcome) => {
      const approved = {
        ...proposition,
        id: "approved",
        effectiveFrom: "2026-10-01",
        effectiveUntil: null,
      };
      const claim = { ...proposition, predicate, value: "USD 30 per month" };
      expect(compareApprovedFacts(claim, "2026-11-23", [approved]).status).toBe(
        outcome,
      );
    },
  );

  it("uses effective dates and shows opposing approved evidence without a truth score", () => {
    const incompatible = {
      ...proposition,
      id: "a",
      polarity: "denies" as const,
      effectiveFrom: "2026-11-01",
      effectiveUntil: "2026-12-01",
    };
    expect(
      compareApprovedFacts(proposition, "2026-01-22", [incompatible]).status,
    ).toBe("insufficient");
    expect(
      compareApprovedFacts(proposition, "2026-11-22", [incompatible]).status,
    ).toBe("conflict");
    expect(
      compareApprovedFacts(proposition, "2026-12-01", [incompatible]).status,
    ).toBe("insufficient");
    expect(
      compareApprovedFacts(proposition, "2026-11-22", [
        incompatible,
        { ...incompatible, id: "b", polarity: "asserts" },
      ]).status,
    ).toBe("mixed");
  });
});
