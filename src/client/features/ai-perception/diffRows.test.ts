import { describe, expect, it } from "vitest";
import { diffRows } from "./diffRows";

describe("diffRows", () => {
  it("keeps unchanged lines aligned and pairs a reworded line into one row", () => {
    expect(
      diffRows("Intro\nOld claim\nPricing", "Intro\nNew claim\nPricing"),
    ).toEqual([
      { left: "Intro", right: "Intro", kind: "same" },
      { left: "Old claim", right: "New claim", kind: "changed" },
      { left: "Pricing", right: "Pricing", kind: "same" },
    ]);
  });

  it("shows an added line with nothing on the left", () => {
    expect(diffRows("A\nB", "A\nNew\nB")).toEqual([
      { left: "A", right: "A", kind: "same" },
      { left: null, right: "New", kind: "added" },
      { left: "B", right: "B", kind: "same" },
    ]);
  });
});
