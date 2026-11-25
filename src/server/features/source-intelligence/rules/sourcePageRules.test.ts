import { describe, expect, it } from "vitest";
import { findMentions, suggestApproach } from "./sourcePageRules";

describe("findMentions", () => {
  it("matches a whole name or a domain, not a fragment", () => {
    const brands = [
      { name: "Rival", domain: "rival.example" },
      { name: "Tool", domain: "tool.example" },
    ];
    expect(findMentions("Compare Rival today", brands)).toEqual(["Rival"]);
    expect(findMentions("Visit tool.example now", brands)).toEqual(["Tool"]);
    expect(findMentions("Arrivals and tooling", brands)).toEqual([]);
  });
});

describe("suggestApproach", () => {
  it("never suggests a gap on a page that already names the brand", () => {
    expect(
      suggestApproach({
        pageKind: "comparison",
        competitorDomain: false,
        namesBrand: true,
      }),
    ).toBe("already_covered");
  });

  it("treats a competitor's own page as an owned content gap and a third-party list as a comparison", () => {
    expect(
      suggestApproach({
        pageKind: "vendor_page",
        competitorDomain: true,
        namesBrand: false,
      }),
    ).toBe("owned_content_gap");
    expect(
      suggestApproach({
        pageKind: "comparison",
        competitorDomain: false,
        namesBrand: false,
      }),
    ).toBe("comparison_opportunity");
  });
});
