import { describe, expect, it } from "vitest";
import { classifySource, type SourceClass } from "./sourceClass";

// Labeled by hand from the domains cited in a real project's AI answers. The
// rules are accepted while every classified source here is right; a source no
// rule covers must stay "unknown".
const SAMPLE: [string, string | null, SourceClass][] = [
  ["www.reddit.com", null, "community"],
  ["news.ycombinator.com", null, "community"],
  ["www.youtube.com", "Loom vs Tella", "video"],
  ["github.com", "cap", "code_docs"],
  ["chromewebstore.google.com", "Loom", "app_store"],
  ["support.atlassian.com", "Record a video", "code_docs"],
  ["www.g2.com", "Loom reviews", "review_site"],
  ["en.wikipedia.org", "Screencast", "reference"],
  ["www.google.com", "Search", "search_engine"],
  ["www.linkedin.com", "post", "social"],
  ["itechguides.com", "10 Best Screen Recorders for Windows", "roundup"],
  ["thedigitalprojectmanager.com", "Best Loom alternatives", "roundup"],
  ["zapier.com", "The 6 best screen recorders in 2026", "roundup"],
  // Vendor and publisher sites no rule can type without reading the page.
  ["obsproject.com", "OBS Studio", "unknown"],
  ["screen.studio", "Screen Studio", "unknown"],
  ["techsmith.com", "Snagit", "unknown"],
  ["fabric.so", "Fabric", "unknown"],
  ["descript.com", "Descript", "unknown"],
  ["vidyard.com", "Vidyard", "unknown"],
];

describe("classifySource", () => {
  it.each(SAMPLE)("%s is %s", (host, title, expected) => {
    expect(classifySource({ host, title })).toBe(expected);
  });

  it("keeps a tracked brand's own class over any platform rule", () => {
    expect(classifySource({ host: "github.com", brand: "competitor" })).toBe(
      "competitor",
    );
  });

  it("does not match a host that merely contains a platform name", () => {
    expect(classifySource({ host: "notreddit.com" })).toBe("unknown");
  });
});
