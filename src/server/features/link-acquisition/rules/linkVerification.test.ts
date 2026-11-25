import { describe, expect, it } from "vitest";
import {
  attributesOf,
  comparableUrl,
  decideOutcome,
  linksTo,
  linksToSite,
  readPage,
} from "./linkVerification";

const html = `<html><head><link rel="canonical" href="/best"><base href="https://blog.com/posts/"></head><body>
<p>Read <a href="https://www.shop.com/swings/?utm_source=x" rel="nofollow sponsored">rope swings</a> today.</p>
<p>Also see https://shop.com/plain and <a href="/about" style="display:none">hidden</a></p>
<a href="https://shop.com/other">other</a></body></html>`;

describe("link verification", () => {
  const reading = readPage(html, "https://blog.com/posts/best");

  it("only counts real hyperlinks, resolved against the page's base", () => {
    expect(reading.links.map((l) => l.href)).toContain(
      "https://blog.com/about",
    );
    expect(linksTo(reading, "https://shop.com/swings")).toHaveLength(1);
    expect(linksTo(reading, "https://shop.com/plain")).toHaveLength(0);
  });

  it("ignores scheme, www, trailing slash and tracking parameters when comparing", () => {
    expect(comparableUrl("http://www.shop.com/a/?utm_medium=z")).toBe(
      comparableUrl("https://shop.com/a"),
    );
    expect(comparableUrl("javascript:void(0)")).toBeNull();
  });

  it("reads rel attributes, the canonical and hidden links", () => {
    const link = linksTo(reading, "https://shop.com/swings")[0];
    expect(link && attributesOf(link)).toEqual({
      isNofollow: true,
      isSponsored: true,
      isUgc: false,
    });
    expect(reading.canonical).toBe("https://blog.com/best");
    expect(reading.links.find((l) => l.href.endsWith("/about"))?.hidden).toBe(
      true,
    );
  });

  it("reports a changed destination or changed attributes instead of confirming", () => {
    const found = linksTo(reading, "https://shop.com/swings")[0] ?? null;
    const same = {
      href: "https://shop.com/swings",
      attributes: { isNofollow: true, isSponsored: true, isUgc: false },
    };
    expect(decideOutcome({ found, otherSiteLinks: [], previous: same })).toBe(
      "confirmed",
    );
    expect(
      decideOutcome({
        found,
        otherSiteLinks: [],
        previous: {
          ...same,
          attributes: { ...same.attributes, isNofollow: false },
        },
      }),
    ).toBe("attributes_changed");
    expect(
      decideOutcome({
        found: null,
        otherSiteLinks: linksToSite(reading, "https://shop.com/swings"),
        previous: same,
      }),
    ).toBe("destination_changed");
    expect(
      decideOutcome({ found: null, otherSiteLinks: [], previous: same }),
    ).toBe("link_missing");
  });
});
