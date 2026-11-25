import { describe, expect, it } from "vitest";
import { extractPage } from "./pageExtractor";

const PAGE = `<!doctype html><html><head>
<title>Best pay-as-you-go transcription tools</title>
<meta name="description" content="Compared on price and accuracy">
<link rel="canonical" href="https://news.example/best">
<script type="application/ld+json">{"@type":"Article","author":{"name":"Dana Lee"},"datePublished":"2026-03-01"}</script>
<script>var hidden = "pay as you go";</script>
</head><body>
<h1>Best pay-as-you-go transcription tools</h1>
<p>We tested five tools. Pricing is $0.25 per minute with no subscription.</p>
<h2>Pros and cons</h2>
<table><tr><th>Tool</th><th>Price</th><th>Offline</th></tr>
<tr><td>Alpha</td><td>$0.25 per minute</td><td>No</td></tr>
<tr><td>Beta</td><td>$9/month</td><td>Yes</td></tr></table>
<p>See <a href="/reviews">our reviews</a> and <a href="https://alpha.example/pricing">Alpha</a>.</p>
<h2>Our verdict</h2><p>Best for travellers: Alpha.</p>
</body></html>`;

describe("page extractor", () => {
  const page = extractPage(PAGE, "https://news.example/best");

  it("reads structure and ignores script text", () => {
    expect(page).toMatchObject({
      title: "Best pay-as-you-go transcription tools",
      canonical: "https://news.example/best",
      author: "Dana Lee",
      publishedAt: "2026-03-01T00:00:00.000Z",
      pageKind: "comparison",
      internalLinkCount: 1,
    });
    expect(page.externalLinks.map((l) => l.url)).toEqual([
      "https://alpha.example/pricing",
    ]);
    expect(page.text).not.toContain("hidden");
    expect(page.tables[0]).toMatchObject({ rows: 3 });
  });

  it("records the wording behind each commercial fact and comparison signal", () => {
    expect(page.commercial.payAsYouGo).toContain("pay-as-you-go");
    expect(page.commercial.noSubscription).toContain("no subscription");
    expect(page.comparison.comparisonTable).toBeDefined();
    expect(page.comparison.verdict).toBeDefined();
    expect(page.firstHand.length).toBeGreaterThan(0);
  });

  it("takes the title from the head, not from icon titles inside the page", () => {
    const withIcons = extractPage(
      `<html><head><title>Pricing | Pepys</title></head><body><svg><title>YouTube</title></svg><svg><title>TikTok</title></svg><h1>Pricing</h1></body></html>`,
      "https://pepys.example/pricing",
    );
    expect(withIcons.title).toBe("Pricing | Pepys");
  });

  it("does not fail on markup it cannot make sense of", () => {
    expect(extractPage("<div><p>unclosed <b>", "not a url").wordCount).toBe(1);
  });
});
