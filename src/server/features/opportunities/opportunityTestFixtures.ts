import type { EngineInputs } from "./types";

export const NOW = new Date("2026-11-16T12:00:00.000Z");
const SHOP = "https://shop.example.com";

// Fixture inputs, never read from a real provider. The rows are chosen so each
// rule has one clear trigger and one near miss.
export function engineInputs(
  overrides: Partial<EngineInputs> = {},
): EngineInputs {
  return {
    gsc: {
      source: "gsc",
      windowStart: "2026-10-15",
      windowEnd: "2026-11-12",
      rows: [
        // improve_title_and_meta: top 3, low CTR.
        {
          query: "ethiopia coffee roast",
          page: `${SHOP}/products/ethiopia-light-roast`,
          clicks: 6,
          impressions: 420,
          ctr: 0.0143,
          position: 2.6,
        },
        // refresh_existing_page: blog, striking distance.
        {
          query: "pour over coffee ratio",
          page: `${SHOP}/blogs/news/pour-over-guide`,
          clicks: 22,
          impressions: 1450,
          ctr: 0.0152,
          position: 11.6,
        },
        // create_page: commercial query no collection or product names.
        {
          query: "best espresso machines",
          page: `${SHOP}/blogs/news/pour-over-guide`,
          clicks: 4,
          impressions: 600,
          ctr: 0.0067,
          position: 18,
        },
        // no_action: too few impressions.
        {
          query: "burr grinder cleaning",
          page: `${SHOP}/collections/coffee-grinders`,
          clicks: 0,
          impressions: 30,
          ctr: 0,
          position: 31,
        },
        // Collection page with demand, ranking below the top 3.
        {
          query: "coffee grinders",
          page: `${SHOP}/collections/coffee-grinders`,
          clicks: 40,
          impressions: 1200,
          ctr: 0.033,
          position: 6.2,
        },
      ],
    },
    pageWindows: {
      currentStart: "2026-10-15",
      currentEnd: "2026-11-12",
      previousStart: "2026-09-17",
      previousEnd: "2026-10-14",
      current: [
        {
          page: `${SHOP}/blogs/news/pour-over-guide`,
          clicks: 10,
          impressions: 900,
          ctr: 0.011,
          position: 14,
        },
      ],
      previous: [
        {
          page: `${SHOP}/blogs/news/pour-over-guide`,
          clicks: 80,
          impressions: 1600,
          ctr: 0.05,
          position: 7,
        },
        {
          page: `${SHOP}/products/ethiopia-light-roast`,
          clicks: 5,
          impressions: 90,
          ctr: 0.05,
          position: 3,
        },
      ],
    },
    store: {
      shopName: "Shop Example",
      products: [
        {
          handle: "ethiopia-light-roast",
          title: "Ethiopia Light Roast",
          description: "Floral.",
          available: true,
          images: [],
          details: "",
        },
      ],
      collections: [
        { handle: "coffee-grinders", title: "Coffee Grinders" },
        { handle: "light-roast-coffee", title: "Light Roast Coffee" },
      ],
      articles: [
        {
          handle: "pour-over-guide",
          title: "Pour Over Brew Guide",
          blogHandle: "news",
        },
        {
          handle: "choosing-coffee-grinders",
          title: "Choosing Coffee Grinders",
          blogHandle: "news",
        },
      ],
    },
    storeMode: "live",
    audit: {
      auditId: "audit-1",
      observedAt: "2026-11-10 09:00:00",
      issues: [
        {
          issueType: "missing-title",
          severity: "critical",
          pageUrl: `${SHOP}/pages/about`,
        },
        {
          issueType: "thin-content",
          severity: "warning",
          pageUrl: `${SHOP}/blogs/news/short`,
        },
        {
          issueType: "orphan-page",
          severity: "warning",
          pageUrl: `${SHOP}/products/seasonal-blend`,
        },
        {
          issueType: "orphan-page",
          severity: "warning",
          pageUrl: `${SHOP}/pages/terms`,
        },
        {
          issueType: "crawl-page-limit",
          severity: "warning",
          pageUrl: SHOP,
        },
      ],
    },
    brandTerms: ["Shop Example"],
    unavailable: [],
    ...overrides,
  };
}

export { SHOP };
