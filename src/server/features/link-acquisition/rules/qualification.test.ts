import { describe, expect, it } from "vitest";
import type { MergedLinkCandidate } from "./linkGapMerge";
import {
  DEFAULT_QUALIFICATION_SETTINGS,
  qualifyCandidate,
  type QualificationEvidence,
} from "./qualification";

const NOW = new Date("2026-11-20T00:00:00Z");

function candidate(
  overrides: Partial<MergedLinkCandidate> = {},
): MergedLinkCandidate {
  return {
    referringDomain: "news.com",
    competitorCount: 3,
    domainRank: 400,
    spamScore: 5,
    firstSeen: "2024-01-01T00:00:00.000Z",
    lostDate: null,
    competitors: [
      {
        competitorDomain: "a.com",
        backlinks: 4,
        referringPages: 4,
        nofollowPages: 0,
        domainRank: 400,
        spamScore: 5,
        firstSeen: "2024-01-01T00:00:00.000Z",
        lostDate: null,
        topPlatform: "organization",
        topPlacement: "main",
      },
    ],
    ...overrides,
  };
}

function run(c: MergedLinkCandidate, evidence: QualificationEvidence[] = []) {
  return qualifyCandidate({
    candidate: c,
    evidence,
    comparedCompetitors: 3,
    settings: DEFAULT_QUALIFICATION_SETTINGS,
    now: NOW,
  });
}

describe("qualifyCandidate", () => {
  it("pursues a strong shared domain and says what it could not see", () => {
    const result = run(candidate());
    expect(result.recommendation).toBe("pursue");
    expect(result.limitations).toContain(
      "No linking page has been read, so relevance and context are not assessed.",
    );
    expect(result.confidence).toBe("medium");
  });

  it("treats spam and rank as soft inputs, never a gate", () => {
    const result = run(candidate({ spamScore: 90, domainRank: 5 }));
    expect(result.recommendation).not.toBe("skip");
    expect(
      result.factors.find((f) => f.factor === "Authority")?.detail,
    ).toContain("heuristic");
  });

  it("does not recommend a spam-flagged site outright, however strong the rest", () => {
    const clean = run(candidate({ spamScore: 5 }));
    const spammy = run(candidate({ spamScore: 70 }));
    expect(clean.recommendation).toBe("pursue");
    expect(spammy.recommendation).toBe("review");
    expect(spammy.limitations.join(" ")).toContain("not recommended outright");
  });

  it("does not score a sponsored link as earned", () => {
    const result = run(candidate(), [
      {
        competitorDomain: "a.com",
        urlFrom: "https://news.com/p",
        urlTo: "https://a.com/",
        pageTitle: null,
        pageLanguage: null,
        semanticLocation: "main",
        isNofollow: true,
        isSponsored: true,
        isUgc: false,
        lostDate: null,
      },
    ]);
    expect(result.attributes.sponsored).toBe(true);
    expect(
      result.factors.find((f) => f.factor === "Link attributes")?.points,
    ).toBe(0);
  });
});
