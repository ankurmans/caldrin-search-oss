import { describe, expect, it } from "vitest";
import {
  classifyBrokenLink,
  classifyLostLink,
  findMention,
  mentionTerms,
} from "./discovery";

const own = "shop.example.com";
const page = (body: string) =>
  `<html><head><title>t</title></head><body>${body}</body></html>`;
const lost = (
  html: string | null,
  linkingPage: "live" | "gone" | "unverified" = "live",
) =>
  classifyLostLink({
    linkingPage,
    html,
    finalUrl: "https://blog.test-site.com/post",
    own,
    target: "live",
  });

describe("lost links", () => {
  it("recovers only when the live page no longer links to the site", () => {
    expect(lost(page("<p>No links</p>")).outcome).toBe("recover");
    expect(
      lost(page('<a href="https://shop.example.com/swings">swings</a>'))
        .outcome,
    ).toBe("still_linking");
  });

  it("does not claim a link was removed when the page could not be read", () => {
    expect(lost(null, "unverified").outcome).toBe("review");
    expect(lost(null, "gone").outcome).toBe("page_gone");
  });
});

describe("broken links", () => {
  it("is fixed when the page works now and unconfirmed when it cannot be fetched", () => {
    expect(classifyBrokenLink({ target: "live" }).outcome).toBe(
      "already_fixed",
    );
    expect(classifyBrokenLink({ target: "unverified" }).outcome).toBe("review");
    expect(classifyBrokenLink({ target: "gone" }).outcome).toBe("recover");
  });
});

describe("brand mentions", () => {
  const find = (body: string) =>
    findMention({
      html: page(body),
      finalUrl: "https://blog.test-site.com/post",
      terms: ["shopco"],
      own,
    });

  it("reports an unlinked mention with the sentence around it", () => {
    const result = find("<p>We tried ShopCo last week and liked it.</p>");
    expect(result).toMatchObject({ kind: "unlinked", term: "shopco" });
    expect(result.kind === "unlinked" && result.snippet).toContain(
      "tried ShopCo last week",
    );
  });

  it("ignores a name inside script text, a longer word, or a page that already links", () => {
    expect(find("<script>var shopco = 1;</script><p>Nothing.</p>").kind).toBe(
      "not_mentioned",
    );
    expect(find("<p>Visit shopcorp today.</p>").kind).toBe("not_mentioned");
    expect(
      find('<p>ShopCo: <a href="https://shop.example.com/">site</a></p>').kind,
    ).toBe("linked");
  });

  it("looks for the brand and the bare domain once each", () => {
    expect(mentionTerms("ShopCo", "shop.example.com")).toEqual([
      "shopco",
      "shop.example.com",
    ]);
    expect(mentionTerms("shopco", "shopco")).toEqual(["shopco"]);
  });
});
