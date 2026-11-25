import { describe, expect, it } from "vitest";
import { decideOpportunities, decideOpportunity } from "./opportunityRules";
import { buildBrief } from "./briefBuilder";
import { buildTemplateDraft } from "./templateDraft";
import { hasBlockingFailure, runQualityChecks } from "./qualityChecks";
import type { StoreSnapshot } from "./storeTypes";

const store: StoreSnapshot = {
  shopName: "Demo Roasters",
  products: [
    {
      handle: "ethiopia-light",
      title: "Ethiopia Light Roast",
      description:
        "A bright light roast coffee with floral notes. Roasted weekly.",
      available: true,
      images: [],
      details: "",
    },
    {
      handle: "old-blend",
      title: "Discontinued Light Blend",
      description: "A light roast coffee.",
      available: false,
      images: [],
      details: "",
    },
  ],
  collections: [{ handle: "light-roast-coffee", title: "Light Roast Coffee" }],
  articles: [
    {
      handle: "brew-guide",
      title: "Pour Over Brew Guide",
      blogHandle: "news",
    },
  ],
};

const row = (over: Partial<Parameters<typeof decideOpportunity>[0]>) => ({
  query: "best light roast coffee",
  page: "https://demo.example/products/ethiopia-light",
  clicks: 4,
  impressions: 400,
  ctr: 0.01,
  position: 9,
  ...over,
});

describe("opportunity rules", () => {
  it("recommends no action below the impression floor", () => {
    expect(decideOpportunity(row({ impressions: 20 }), []).action).toBe(
      "no_action",
    );
  });

  it("flags a top-3 ranking with weak CTR as a snippet problem", () => {
    const d = decideOpportunity(row({ position: 2, ctr: 0.02 }), []);
    expect(d.action).toBe("improve_title_and_meta");
    expect(d.reason).toContain("2.0");
  });

  it("prefers the collection page when the query names the collection", () => {
    const d = decideOpportunity(
      row({ query: "light roast coffee beans" }),
      store.collections,
    );
    expect(d.action).toBe("update_collection_page");
    expect(d.matchedCollectionHandle).toBe("light-roast-coffee");
  });

  it("recommends refreshing an article that ranks at striking distance", () => {
    const d = decideOpportunity(
      row({
        query: "pour over ratio",
        page: "https://demo.example/blogs/news/brew-guide",
        position: 11,
      }),
      [],
    );
    expect(d.action).toBe("refresh_existing_page");
  });

  it("recommends a new article only for informational queries without a blog page", () => {
    const d = decideOpportunity(
      row({ query: "how to choose light roast", ctr: 0.04, position: 14 }),
      [],
    );
    expect(d.action).toBe("new_article");
  });

  it("keeps one decision per query, the one with the most impressions", () => {
    const out = decideOpportunities(
      [row({ impressions: 150 }), row({ impressions: 900, page: "/other" })],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.impressions).toBe(900);
  });
});

describe("brief, template draft and quality checks", () => {
  const decision = decideOpportunity(
    row({ query: "best light roast coffee", position: 14, ctr: 0.04 }),
    store.collections,
  );
  const brief = buildBrief(decision, store);

  it("never matches an unavailable product", () => {
    expect(brief.products.map((p) => p.handle)).toEqual(["ethiopia-light"]);
  });

  it("a fresh template draft is blocked until the merchant fills the gaps", () => {
    const draft = buildTemplateDraft(brief, store);
    const checks = runQualityChecks(draft, store);
    expect(
      checks.find((c) => c.key === "no_unresolved_placeholders")?.passed,
    ).toBe(false);
    expect(hasBlockingFailure(checks)).toBe(true);
  });

  it("clears the placeholder block once facts are supplied", () => {
    const draft = buildTemplateDraft(brief, store);
    draft.bodyHtml = draft.bodyHtml.replace(
      /<p>\[MERCHANT TO ADD[^<]*<\/p>/g,
      "<p>Grind size and water temperature change the cup.</p>",
    );
    const checks = runQualityChecks(draft, store);
    expect(hasBlockingFailure(checks)).toBe(false);
  });

  it("blocks invented statistics, testing claims and unavailable products", () => {
    const draft = buildTemplateDraft(brief, store);
    draft.bodyHtml =
      '<h2>A</h2><p>Studies show 87% prefer it and we tested it.</p><a href="/products/old-blend">x</a><a href="/products/missing">y</a><h2>B</h2>';
    const failed = runQualityChecks(draft, store)
      .filter((c) => !c.passed && c.severity === "block")
      .map((c) => c.key);
    expect(failed).toEqual(
      expect.arrayContaining([
        "no_unsourced_claims",
        "no_fabricated_experience",
        "internal_links_resolve",
        "products_available",
      ]),
    );
  });

  it("accepts a link to a post in any blog and warns when an article has no image or call to action", () => {
    const draft = buildTemplateDraft(brief, store);
    const shop = {
      ...store,
      articles: [
        {
          handle: "ride-guide",
          title: "Ride Guide",
          blogHandle: "ride-on-toys",
        },
      ],
    };
    draft.bodyHtml =
      '<h2>A</h2><p>See the <a href="/blogs/ride-on-toys/ride-guide">guide</a>.</p><h2>B</h2><p>Plain ending.</p>';
    const checks = runQualityChecks(draft, shop);
    const byKey = Object.fromEntries(checks.map((c) => [c.key, c.passed]));
    expect(byKey["internal_links_resolve"]).toBe(true);
    expect(byKey["has_image"]).toBe(false);
    expect(byKey["has_call_to_action"]).toBe(false);

    draft.bodyHtml +=
      '<img src="https://cdn.shopify.com/a.jpg" alt="x"><p>Shop the <a href="/products/ethiopia-light">roast</a>.</p>';
    const fixed = Object.fromEntries(
      runQualityChecks(draft, shop).map((c) => [c.key, c.passed]),
    );
    expect(fixed["has_image"]).toBe(true);
    expect(fixed["has_call_to_action"]).toBe(true);
  });
});
