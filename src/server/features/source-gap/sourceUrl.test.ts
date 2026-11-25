import { describe, expect, it } from "vitest";
import {
  isFileUrl,
  isHomepageUrl,
  mergeByCanonical,
  normalizeSourceUrl,
} from "./sourceUrl";

describe("source URL handling", () => {
  it("counts spelling variants of one page as one source", () => {
    const variants = [
      "http://www.example.com/best-tool/?utm_source=chatgpt.com#top",
      "https://example.com/best-tool",
      "https://example.com/best-tool/?utm_medium=x",
    ];
    expect(new Set(variants.map(normalizeSourceUrl)).size).toBe(1);
    expect(normalizeSourceUrl("https://example.com/a?id=1")).not.toBe(
      normalizeSourceUrl("https://example.com/a?id=2"),
    );
  });

  it("tells files and front pages from pages", () => {
    expect(isFileUrl("https://example.com/report.pdf")).toBe(true);
    expect(isFileUrl("https://example.com/report")).toBe(false);
    expect(isHomepageUrl("https://example.com/")).toBe(true);
    expect(isHomepageUrl("https://example.com/?ref=x")).toBe(false);
    expect(isHomepageUrl("https://example.com/best")).toBe(false);
  });

  it("counts a page under the canonical page another cited source names", () => {
    const target = mergeByCanonical([
      { key: "https://a.com/amp/post", canonical: "https://a.com/post" },
      { key: "https://a.com/post", canonical: null },
      {
        key: "https://b.com/x",
        canonical: "https://elsewhere.com/never-cited",
      },
    ]);
    expect(target.get("https://a.com/amp/post")).toBe("https://a.com/post");
    expect(target.get("https://b.com/x")).toBe("https://b.com/x");
  });
});
