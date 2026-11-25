import { describe, expect, it } from "vitest";
import { buildDraft, hasPlaceholder, type DraftInput } from "./outreachDraft";

const base: DraftInput = {
  mode: "earned_editorial",
  brandName: "Shop",
  referringDomain: "swingblog.com",
  pageUrl: null,
  evidence: [
    {
      urlFrom: "https://swingblog.com/best-swings",
      pageTitle: "Best swings",
      anchor: "rope swings",
      competitorDomain: "rival.com",
      isSponsored: false,
    },
  ],
  targetUrl: "https://shop.com/rope-swings",
  contactName: null,
};

describe("outreach draft", () => {
  it("cites only the recorded page and competitor, and invents no name or history", () => {
    const draft = buildDraft(base);
    expect(draft?.body).toContain("https://swingblog.com/best-swings");
    expect(draft?.body).toContain("rival.com");
    expect(draft?.body.startsWith("Hello,")).toBe(true);
    expect(draft?.body).not.toMatch(/as we discussed|following up|loved/i);
  });

  it("refuses when there is no real page to refer to", () => {
    expect(buildDraft({ ...base, evidence: [] })).toBeNull();
    expect(
      buildDraft({ ...base, evidence: [], pageUrl: "https://swingblog.com/x" }),
    ).not.toBeNull();
  });

  it("discloses a sponsored placement as sponsored", () => {
    const draft = buildDraft({ ...base, mode: "sponsored_distribution" });
    expect(draft?.body).toMatch(/sponsored/i);
    expect(draft?.subject).toMatch(/sponsored/i);
  });

  it("detects a placeholder a person has not filled in", () => {
    expect(hasPlaceholder("Hi [[name]]")).toBe(true);
    expect(hasPlaceholder("Hi Sam")).toBe(false);
  });
});
