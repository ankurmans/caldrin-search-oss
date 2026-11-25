import { describe, expect, it } from "vitest";
import { readingsFromOutput } from "./perceptionReading";

const brands = [
  { name: "Caldrin Search", domain: "caldrin.co", own: true },
  { name: "Rival", domain: "rival.example", own: false },
];
const TEXT =
  "Rival is cheaper, but Caldrin Search tracks more engines and I recommend it for agencies.";
const entry = (over: Record<string, unknown> = {}) => ({
  domain: "caldrin.co",
  stance: "recommended" as const,
  sentiment: "positive" as const,
  confidence: "high" as const,
  evidence: "I recommend it for agencies",
  strengths: [{ text: "Tracks more engines", quote: "tracks more engines" }],
  weaknesses: [],
  objections: [],
  comparisons: [{ domain: "rival.example", outcome: "preferred" as const }],
  ...over,
});

describe("readingsFromOutput", () => {
  it("keeps only what the answer text supports", () => {
    const [reading] = readingsFromOutput(
      {
        brands: [
          entry({
            evidence: "a sentence the answer never wrote",
            strengths: [
              { text: "Tracks more engines", quote: "tracks more engines" },
              { text: "Free forever", quote: "is free forever" },
            ],
            comparisons: [
              { domain: "rival.example", outcome: "preferred" },
              { domain: "unlisted.example", outcome: "equal" },
              { domain: "caldrin.co", outcome: "equal" },
            ],
          }),
          entry({ domain: "ghost.example" }),
        ],
      },
      TEXT,
      brands,
    );
    expect(reading.evidence).toBeNull();
    expect(reading.points.map((p) => p.text)).toEqual(["Tracks more engines"]);
    expect(reading.comparisons).toEqual([
      {
        competitorDomain: "rival.example",
        competitorName: "Rival",
        outcome: "preferred",
      },
    ]);
  });

  it("gives no reading to a brand the answer does not name", () => {
    expect(
      readingsFromOutput({ brands: [entry()] }, "Rival is cheaper.", brands),
    ).toEqual([]);
  });

  it("flags a brand matched only by its domain stem", () => {
    const [reading] = readingsFromOutput(
      { brands: [entry({ domain: "acme.com" })] },
      "Build with acme for speed.",
      [{ name: "acme.com", domain: "acme.com", own: true }],
    );
    expect(reading.ambiguousName).toBe(true);
  });
});
