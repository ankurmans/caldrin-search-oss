import { describe, expect, it } from "vitest";
import { engineInputs, NOW, SHOP } from "../opportunityTestFixtures";
import type { CompetitorKeyword, OpportunityCandidate } from "../types";
import { buildFreeCandidates } from "./buildCandidates";
import { decliningCandidates } from "./decliningRules";
import { classifyIntent } from "./intentRules";
import { keywordGapCandidates } from "./keywordGapRules";
import { shouldRunPaid } from "./paidGuard";
import { OpportunityRefusal } from "../types";

const observedAt = NOW.toISOString();

function byKey(candidates: OpportunityCandidate[], prefix: string) {
  return candidates.filter((c) => c.dedupeKey.startsWith(prefix));
}

describe("classifyIntent", () => {
  const ctx = { brandTerms: ["Shop Example"], store: engineInputs().store };
  it.each([
    ["shop example", "navigational"],
    ["buy light roast coffee", "transactional"],
    ["best espresso machines", "commercial"],
    ["how to brew pour over", "informational"],
    ["ethiopia light roast", "commercial"],
    ["zzzz qqqq", null],
  ] as const)("%s -> %s", (query, expected) => {
    expect(classifyIntent(query, ctx)).toBe(expected);
  });
});

describe("free candidates", () => {
  const { candidates, skipped } = buildFreeCandidates(
    engineInputs(),
    observedAt,
  );

  it("every candidate has evidence and a priority reason naming a number", () => {
    expect(candidates.length).toBeGreaterThan(8);
    for (const c of candidates) {
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.priorityReason).toMatch(/\d/);
      expect(c.observedAt).toBe(observedAt);
    }
    expect(skipped).toEqual([]);
  });

  it("reuses the GSC rules and states the thresholds in the priority", () => {
    const refresh = candidates.find(
      (c) =>
        c.query === "pour over coffee ratio" &&
        c.action === "refresh_existing_page",
    );
    expect(refresh?.priority).toBe("high");
    expect(refresh?.priorityReason).toContain("1450 impressions");
    expect(refresh?.priorityReason).toContain("1000");
    expect(refresh?.dataSource).toBe("gsc");
  });

  it("emits no_action with the rule's reason", () => {
    const none = candidates.find((c) => c.query === "burr grinder cleaning");
    expect(none?.action).toBe("no_action");
    expect(none?.reason).toContain("Only 30 impressions");
    expect(none?.priority).toBe("low");
  });

  it("proposes a commercial page only for a query the catalog does not name", () => {
    const pages = byKey(candidates, "create_page::");
    expect(pages.map((p) => p.query)).toEqual(["best espresso machines"]);
    expect(pages[0]?.intent).toBe("commercial");
    expect(pages[0]?.reason).toContain("store's 2 collections or 1 products");
  });

  it("generates internal links from orphan audit rows and collection/article topics", () => {
    const links = byKey(candidates, "ilink::");
    const linkKeys = links.map((l) => l.dedupeKey);
    linkKeys.sort();
    expect(linkKeys).toEqual([
      "ilink::article::choosing-coffee-grinders::coffee-grinders",
      `ilink::orphan::${SHOP}/products/seasonal-blend`,
    ]);
    const article = links.find((l) => l.dedupeKey.includes("article"));
    expect(article?.reason).toContain("Existing links were not checked");
    expect(article?.matchedCollectionHandle).toBe("coffee-grinders");
  });

  it("generates technical, title and thin-content fixes from stored audit rows", () => {
    const actions = Object.fromEntries(
      byKey(candidates, "technical::").map((c) => [c.dedupeKey, c.action]),
    );
    expect(actions).toEqual({
      "technical::missing-title": "improve_title_and_meta",
      "technical::thin-content": "refresh_existing_page",
    });
    const missingTitle = candidates.find(
      (c) => c.dedupeKey === "technical::missing-title",
    );
    expect(missingTitle?.priority).toBe("high");
    expect(missingTitle?.dataSource).toBe("site_audit");
  });

  it("flags a collection with no supporting article", () => {
    const support = byKey(candidates, "support::");
    expect(support.map((s) => s.matchedCollectionHandle)).toEqual([
      "light-roast-coffee",
    ]);
    expect(support[0]?.priority).toBe("low");
    expect(support[0]?.dataSource).toBe("shopify");
  });

  it("reports rules it could not run instead of inventing data", () => {
    const out = buildFreeCandidates(
      engineInputs({
        gsc: null,
        pageWindows: null,
        store: null,
        audit: null,
        unavailable: [
          { source: "gsc", reason: "Search Console is not connected." },
        ],
      }),
      observedAt,
    );
    expect(out.candidates).toEqual([]);
    expect(out.skipped.map((s) => s.rule)).toEqual([
      "gsc",
      "gsc",
      "shopify",
      "site_audit",
    ]);
  });
});

describe("declining pages", () => {
  const windows = engineInputs().pageWindows!;

  it("flags a page that kept 60% or less of its clicks, and ignores low-traffic pages", () => {
    const out = decliningCandidates(windows, observedAt);
    expect(out).toHaveLength(1);
    const page = out[0];
    expect(page.dedupeKey).toBe(
      `declining::${SHOP}/blogs/news/pour-over-guide`,
    );
    expect(page.action).toBe("refresh_existing_page");
    expect(page.priority).toBe("high");
    expect(page.priorityReason).toContain("70 fewer clicks (80 to 10)");
  });

  it("treats a page missing from the current window as zero clicks", () => {
    const out = decliningCandidates({ ...windows, current: [] }, observedAt);
    expect(out[0]?.clicks).toBe(0);
    expect(out[0]?.priorityReason).toContain("80 fewer clicks (80 to 0)");
  });

  it("points at the snippet when impressions held but CTR fell", () => {
    const out = decliningCandidates(
      {
        ...windows,
        current: [
          {
            page: `${SHOP}/blogs/news/pour-over-guide`,
            clicks: 20,
            impressions: 1500,
            ctr: 0.013,
            position: 7,
          },
        ],
      },
      observedAt,
    );
    expect(out[0]?.action).toBe("improve_title_and_meta");
  });

  it("does not flag a page within the decline ratio", () => {
    const out = decliningCandidates(
      {
        ...windows,
        current: [
          {
            page: `${SHOP}/blogs/news/pour-over-guide`,
            clicks: 60,
            impressions: 1500,
            ctr: 0.04,
            position: 7,
          },
        ],
      },
      observedAt,
    );
    expect(out).toEqual([]);
  });
});

const keyword = (overrides: Partial<CompetitorKeyword>): CompetitorKeyword => ({
  keyword: "cold brew concentrate",
  competitorDomain: "rival.com",
  competitorPosition: 4,
  competitorUrl: "https://rival.com/cold-brew",
  searchVolume: 2400,
  keywordDifficulty: null,
  ...overrides,
});

describe("keyword gaps", () => {
  const provider = (keywords: CompetitorKeyword[]) => ({
    keywords,
    observedAt,
  });

  it("keeps only keywords the site has no Search Console row for", () => {
    const out = keywordGapCandidates(
      engineInputs(),
      provider([
        keyword({}),
        keyword({ keyword: "pour over coffee ratio" }),
        keyword({ keyword: "far down", competitorPosition: 45 }),
        keyword({ keyword: "tiny", searchVolume: 10 }),
        keyword({ keyword: "no volume", searchVolume: null }),
      ]),
      observedAt,
    );
    expect(out.map((c) => c.query)).toEqual(["cold brew concentrate"]);
    expect(out[0]?.dataSource).toBe("competitor");
    expect(out[0]?.priority).toBe("high");
    expect(out[0]?.priorityReason).toContain("2400 monthly searches");
    expect(out[0]?.evidence.map((e) => e.source)).toContain("dataforseo");
  });

  it("makes no gap claim against simulated Search Console rows", () => {
    const inputs = engineInputs();
    const out = keywordGapCandidates(
      { ...inputs, gsc: { ...inputs.gsc!, source: "simulated" } },
      provider([keyword({})]),
      observedAt,
    );
    expect(out).toEqual([]);
  });
});

describe("paid guard", () => {
  const paid = {
    competitorDomains: ["rival.com"],
    estimatedUsd: 0.5,
    source: {
      fetchCompetitorKeywords: () => Promise.reject(new Error("never")),
    },
  };
  const gate = { assertWithinLimits: () => Promise.resolve() };

  it("refuses without allowPaid", () => {
    expect(() =>
      shouldRunPaid({
        paid,
        spendGate: gate,
        recordCost: () => Promise.resolve(),
      }),
    ).toThrow(OpportunityRefusal);
  });

  it("refuses when spend cannot be checked or recorded", () => {
    expect(() => shouldRunPaid({ allowPaid: true, paid })).toThrow(
      "Spend limits could not be checked",
    );
  });

  it("does nothing when no paid rule was requested", () => {
    expect(shouldRunPaid({})).toBe(false);
    expect(shouldRunPaid({ allowPaid: true })).toBe(false);
  });
});
