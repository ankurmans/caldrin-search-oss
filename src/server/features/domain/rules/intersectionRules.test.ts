import { describe, expect, it } from "vitest";
import {
  compareEvidence,
  gapFor,
  normalizeQuery,
  organicState,
  planOpportunity,
  type AiAnswerEvidence,
  type OrganicEvidence,
} from "./intersectionRules";

const organic = (over: Partial<OrganicEvidence> = {}): OrganicEvidence => ({
  source: "provider_keywords",
  position: 3,
  depth: null,
  url: "https://a.com/x",
  checkedAt: "2026-05-10T00:00:00.000Z",
  locationCode: 2840,
  ...over,
});
const answer = (over: Partial<AiAnswerEvidence> = {}): AiAnswerEvidence => ({
  engine: "google_ai_overview",
  source: "provider_mentions",
  named: true,
  cited: false,
  recommended: null,
  citedUrls: [],
  competingUrls: [],
  observedAt: "2026-05-12T00:00:00.000Z",
  locationCode: 2840,
  ...over,
});

describe("compareEvidence", () => {
  it("refuses different markets and stale pairs, and says why", () => {
    expect(
      compareEvidence(organic({ locationCode: 2826 }), answer()),
    ).toMatchObject({
      comparable: false,
      reason: expect.stringMatching(/market/) as unknown,
    });
    expect(
      compareEvidence(
        organic(),
        answer({ observedAt: "2026-08-01T00:00:00.000Z" }),
      ),
    ).toMatchObject({
      comparable: false,
      reason: expect.stringMatching(/days apart/) as unknown,
    });
    expect(compareEvidence(organic(), answer())).toEqual({
      comparable: true,
      daysApart: 2,
    });
  });

  it("treats provider ChatGPT data as US only, whatever the answer's own market", () => {
    const chatgpt = answer({ engine: "chatgpt", locationCode: 2826 });
    expect(
      compareEvidence(organic({ locationCode: 2826 }), chatgpt),
    ).toMatchObject({ comparable: false });
    expect(
      compareEvidence(organic({ locationCode: 2840 }), chatgpt),
    ).toMatchObject({ comparable: true });
  });
});

describe("organicState", () => {
  it("never reads a missing reading, or an unknown depth, as absence", () => {
    expect(organicState(null)).toBe("no_capture");
    expect(organicState(organic({ position: null, depth: null }))).toBe(
      "no_capture",
    );
    expect(organicState(organic({ position: null, depth: 10 }))).toBe(
      "outside_depth",
    );
  });
});

describe("gapFor and planOpportunity", () => {
  it("only calls a domain missing from both when answers cite someone else", () => {
    expect(gapFor("outside_depth", "absent", false)).toBeNull();
    expect(gapFor("outside_depth", "absent", true)).toBe("missing_from_both");
    expect(gapFor("ranked", "cited", true)).toBeNull();
    expect(gapFor("ranked", "named_only", false)).toBe("ranks_not_cited");
  });

  it("recommends a refresh from the ranking page, and a new page only on a set buyer intent", () => {
    expect(
      planOpportunity({
        gap: "ranks_not_cited",
        organicUrl: "https://a.com/x",
        position: 4,
        intent: null,
      }),
    ).toMatchObject({ ok: true, action: "refresh_existing_page" });
    expect(
      planOpportunity({
        gap: "missing_from_both",
        organicUrl: null,
        position: null,
        intent: null,
      }),
    ).toMatchObject({ ok: false });
    expect(
      planOpportunity({
        gap: "missing_from_both",
        organicUrl: null,
        position: null,
        intent: "commercial",
      }),
    ).toMatchObject({ ok: true, action: "create_page" });
  });

  it("does not turn a citation into a page to build", () => {
    expect(
      planOpportunity({
        gap: "cited_without_ranking",
        organicUrl: null,
        position: null,
        intent: "commercial",
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("normalizeQuery", () => {
  it("matches questions across case, spacing and trailing punctuation", () => {
    expect(normalizeQuery("  What is  SEO? ")).toBe("what is seo");
  });
});
