import { describe, expect, it } from "vitest";
import { classifyAnchor } from "./anchorClassification";

describe("classifyAnchor", () => {
  it("labels brand, url, generic and other anchors", () => {
    expect(classifyAnchor("Luma Creative", "lumacreative.com")).toBe("branded");
    expect(
      classifyAnchor("visit lumacreative.com now", "lumacreative.com"),
    ).toBe("branded");
    expect(
      classifyAnchor("https://lumacreative.com/", "lumacreative.com"),
    ).toBe("url");
    expect(classifyAnchor("Click here", "lumacreative.com")).toBe("generic");
    expect(classifyAnchor("corporate video", "lumacreative.com")).toBe("other");
    expect(classifyAnchor("  ", "lumacreative.com")).toBe("empty");
  });
});
