import { describe, expect, it } from "vitest";
import {
  campaignModeFor,
  checkTransition,
  dedupeKeyFor,
  matchAsset,
} from "./prospectRules";

describe("prospect rules", () => {
  it("gives the same key to the same site however it was written", () => {
    expect(dedupeKeyFor("https://www.Blog.com/")).toBe("blog.com");
    expect(dedupeKeyFor("blog.com", "https://blog.com/best/")).toBe(
      "blog.com|/best",
    );
  });

  it("never files a sponsored site as earned", () => {
    expect(campaignModeFor("earned_editorial", true)).toEqual({
      mode: "sponsored_distribution",
      changed: true,
    });
    expect(campaignModeFor("earned_editorial", false).mode).toBe(
      "earned_editorial",
    );
  });

  it("makes approval, contact and acquisition depend on what happened", () => {
    const none = {
      hasApprovedDraft: false,
      hasSentDraft: false,
      hasConfirmedPlacement: false,
    };
    expect(checkTransition("outreach_approved", none)).toMatch(/approve/i);
    expect(checkTransition("contacted", none)).toMatch(/exported or sent/i);
    expect(checkTransition("acquired", none)).toMatch(/verify/i);
    expect(checkTransition("rejected", none)).toBeNull();
    expect(
      checkTransition("acquired", { ...none, hasConfirmedPlacement: true }),
    ).toBeNull();
  });

  it("prefers an existing page and only asks for a new asset when nothing is close", () => {
    const ownPages = [
      { url: "https://shop.com/collections/rope-swings", title: "Rope swings" },
      { url: "https://shop.com/about", title: "About us" },
    ];
    expect(
      matchAsset({
        competitorDestinations: [
          { url: "https://rival.com/collections/rope-swings", title: null },
        ],
        ownPages,
      }),
    ).toMatchObject({
      kind: "existing",
      url: "https://shop.com/collections/rope-swings",
    });
    expect(
      matchAsset({
        competitorDestinations: [
          {
            url: "https://rival.com/guides/tree-safety-checklist",
            title: "Tree safety checklist",
          },
        ],
        ownPages,
      }),
    ).toMatchObject({ kind: "none", topic: "Tree safety checklist" });
    expect(matchAsset({ competitorDestinations: [], ownPages }).kind).toBe(
      "unknown",
    );
  });
});
