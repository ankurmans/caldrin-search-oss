import { describe, expect, it } from "vitest";
import { aiMentionSpans } from "./aiVisibilityMatching";
import {
  detectRecommendation,
  recommendationEvidence,
} from "./aiVisibilityRecommendation";

const verdict = (text: string, brand: string) =>
  detectRecommendation(text, aiMentionSpans(text, [brand]));

describe("explicit recommendation detector", () => {
  it.each([
    ["I recommend Ahrefs for keyword research.", "Ahrefs", true],
    ["I highly recommend using Ahrefs, Semrush, and Moz.", "Semrush", true],
    ["We'd suggest trying Ahrefs first.", "Ahrefs", true],
    ["Ahrefs is the best choice for backlink data.", "Ahrefs", true],
    ["Semrush is highly recommended for agencies.", "Semrush", true],
    ["I would not recommend Moz for large sites.", "Moz", false],
    ["Moz is not recommended for large sites.", "Moz", false],
    ["I'd recommend against Moz.", "Moz", false],
  ])("reads %j for %s as %s", (text, brand, expected) => {
    expect(verdict(text, brand)).toBe(expected);
  });

  it.each([
    // Listed among options: no verdict, which is not a "no".
    ["Popular tools include Ahrefs, Semrush, and Moz.", "Moz"],
    // A comparison puts the verdict on the other brand.
    ["I recommend Ahrefs over Semrush.", "Semrush"],
    ["I recommend Ahrefs, but not Semrush.", "Semrush"],
    // The phrase must follow its own brand, not a list that ends before it.
    ["Ahrefs, Semrush and Moz are the best choice for SEO teams.", "Ahrefs"],
    // Another sentence's verdict does not carry over.
    ["I recommend Ahrefs. Semrush also exists.", "Semrush"],
    // Opposite verdicts on one brand cancel out.
    ["I recommend Moz. Moz is not recommended for large sites.", "Moz"],
  ])("finds no verdict in %j for %s", (text, brand) => {
    expect(verdict(text, brand)).toBeNull();
  });

  it("finds no verdict for a brand the answer does not mention", () => {
    expect(detectRecommendation("I recommend Ahrefs.", [])).toBeNull();
  });

  it.each([
    [
      "I highly recommend using Ahrefs today.",
      "Ahrefs",
      "I highly recommend using",
      true,
    ],
    [
      "Ahrefs (paid) is the best choice here.",
      "Ahrefs",
      "is the best choice",
      true,
    ],
    ["I'd recommend against Moz.", "Moz", "recommend against", false],
    [
      "Moz is not recommended for large sites.",
      "Moz",
      "is not recommended",
      false,
    ],
  ])(
    "finds the wording behind the verdict in %j",
    (text, brand, wording, expected) => {
      const result = recommendationEvidence(
        text,
        aiMentionSpans(text, [brand]),
      );
      expect(result.verdict).toBe(expected);
      expect(result.phrases.map((p) => text.slice(p.start, p.end))).toEqual([
        wording,
      ]);
    },
  );

  it("keeps both phrases when opposite verdicts cancel out", () => {
    const text = "I recommend Moz. Moz is not recommended for large sites.";
    const result = recommendationEvidence(text, aiMentionSpans(text, ["Moz"]));
    expect(result.verdict).toBeNull();
    expect(result.phrases.map((p) => p.verdict)).toEqual([true, false]);
  });
});
