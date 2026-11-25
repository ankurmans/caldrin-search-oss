import { describe, expect, it } from "vitest";
import type {
  IntelFact,
  IntelMatch,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";
import { markdownToText } from "@/server/features/ai-visibility/providers/dataforseoEvidence";
import { detectCitationGaps } from "./citationGapRules";
import {
  buildSourceRows,
  citedPassages,
  type CitedSource,
} from "./citationSourceRules";
import { gapCandidate } from "./gapOpportunity";

// Labeled demo data: fictional brands and sites.
const brand = (domain: string, over: Partial<IntelMatch> = {}): IntelMatch => ({
  name: domain.split(".")[0],
  domain,
  own: domain === "you.example",
  mentioned: false,
  cited: false,
  recommended: null,
  firstMention: null,
  ...over,
});
let n = 0;
function answer(
  over: Partial<IntelFact> & { brands?: IntelMatch[] },
): IntelFact {
  n++;
  return {
    id: `o${n}`,
    runId: "r1",
    promptId: `p${n}`,
    prompt: "Best quoting tool for agents?",
    topic: "Quoting",
    intent: null,
    branded: false,
    engine: "chatgpt",
    status: "completed",
    hasAnswer: true,
    model: null,
    collectedAt: `2026-11-1${n % 10}T00:00:00.000Z`,
    brands: [brand("you.example"), brand("rival.example", { mentioned: true })],
    ...over,
  };
}
const cite = (fact: IntelFact, url: string): CitedSource => ({
  observationId: fact.id,
  url,
  domain: new URL(url).hostname,
  title: null,
});

describe("cited sources", () => {
  it("counts each site once per answer, across www and case, and says whose site it is", () => {
    const a = answer({});
    const b = answer({ status: "failed", hasAnswer: false });
    const rows = buildSourceRows(
      [a, b],
      [
        cite(a, "https://www.Review.example/a"),
        cite(a, "https://review.example/a"),
        cite(a, "https://review.example/b"),
        cite(a, "https://rival.example/pricing"),
        cite(b, "https://review.example/a"),
      ],
    );
    const review = rows.find((r) => r.domain === "review.example")!;
    expect(review).toMatchObject({
      kind: "third_party",
      answers: 1,
      ownNamedAnswers: 0,
    });
    expect(review.brandsNamed).toEqual([
      { domain: "rival.example", name: "rival", own: false, answers: 1 },
    ]);
    expect(rows.find((r) => r.domain === "rival.example")?.kind).toBe(
      "competitor",
    );
  });

  it("quotes only the saved answer's own lines around a citation", () => {
    const md =
      "Intro without sources.\n\n1\\. **Rival** is popular [review.example](https://review.example/a).\n\nUnrelated closing line.";
    expect(
      citedPassages(
        md,
        ["https://review.example/a"],
        "review.example",
        markdownToText,
      ),
    ).toEqual(["1. Rival is popular ."]);
    expect(
      citedPassages(
        md,
        ["https://other.example/"],
        "other.example",
        markdownToText,
      ),
    ).toEqual([]);
  });
});

describe("citation gaps", () => {
  it("flags missing content when competitor pages are cited and yours never are", () => {
    const a = answer({ runId: "r1" });
    const b = answer({ runId: "r2" });
    const findings = detectCitationGaps(
      [a, b],
      [cite(a, "https://rival.example/p")],
    );
    const gap = findings.find((f) => f.type === "missing_commercial_content")!;
    expect(gap).toMatchObject({
      action: "new_article",
      promptGroup: "Quoting",
      answersInGroup: 2,
    });
    expect(gap.sources).toEqual([
      {
        domain: "rival.example",
        urls: ["https://rival.example/p"],
        answers: 1,
      },
    ]);

    const ownCited = answer({
      brands: [
        brand("you.example", { cited: true }),
        brand("rival.example", { mentioned: true }),
      ],
    });
    expect(
      detectCitationGaps(
        [a, b, ownCited],
        [cite(a, "https://rival.example/p")],
      ).some((f) => f.type === "missing_commercial_content"),
    ).toBe(false);
  });

  it("uses a set comparison intent, and falls back to wording only when none is set", () => {
    const byIntent = answer({ intent: "comparison", prompt: "Which tool?" });
    const byWording = answer({ prompt: "Rival vs others" });
    const plain = answer({ prompt: "Which tool?", intent: "informational" });
    const gap = detectCitationGaps([byIntent, byWording, plain], []).find(
      (f) => f.type === "missing_comparison_coverage",
    )!;
    expect(new Set(gap.prompts.map((p) => p.promptId))).toEqual(
      new Set([byIntent.promptId, byWording.promptId]),
    );
    expect(gap.summary).toMatch(/from their wording/);
  });

  it("separates a repeatedly cited third-party site from one-off corroboration", () => {
    const a = answer({ runId: "r1" });
    const b = answer({ runId: "r2" });
    const repeated = detectCitationGaps(
      [a, b],
      [
        cite(a, "https://review.example/1"),
        cite(b, "https://review.example/2"),
      ],
    );
    expect(repeated.find((f) => f.type === "third_party_publisher")?.key).toBe(
      "ai_gap::third_party_publisher::Quoting::review.example",
    );
    expect(
      repeated.some((f) => f.type === "missing_independent_corroboration"),
    ).toBe(false);

    const once = detectCitationGaps(
      [a, b],
      [cite(a, "https://review.example/1")],
    );
    expect(
      once.some((f) => f.type === "missing_independent_corroboration"),
    ).toBe(true);
  });

  it("asks for a review only when answers explicitly recommend against you", () => {
    const against = answer({
      brands: [brand("you.example", { mentioned: true, recommended: false })],
    });
    const findings = detectCitationGaps([against], []);
    expect(findings.map((f) => f.type)).toContain("brand_information_review");
  });

  it("marks a one-run group uncertain, caps it at medium and adds a measurement note with no action", () => {
    const facts = [answer({}), answer({}), answer({})];
    const findings = detectCitationGaps(facts, [
      cite(facts[0], "https://rival.example/p"),
    ]);
    const gap = findings.find((f) => f.type === "missing_commercial_content")!;
    expect(gap.uncertain).toBe(true);
    expect(gap.priority).toBe("medium");
    expect(gap.priorityReason).toMatch(/Lowered to medium/);
    const note = findings.find((f) => f.type === "measurement_uncertainty")!;
    expect(note.action).toBeNull();
    expect(() => gapCandidate(note, "2026-11-17T00:00:00.000Z")).toThrow();
  });

  it("gives no findings for a group with no answered collections", () => {
    expect(
      detectCitationGaps([answer({ status: "failed", hasAnswer: false })], []),
    ).toEqual([]);
  });

  it("keeps the prompt group, competitors, sources and dates on the opportunity", () => {
    const a = answer({ runId: "r1" });
    const b = answer({ runId: "r2" });
    const gap = detectCitationGaps(
      [a, b],
      [cite(a, "https://rival.example/p")],
    ).find((f) => f.type === "missing_commercial_content")!;
    const candidate = gapCandidate(gap, "2026-11-17T00:00:00.000Z");
    expect(candidate).toMatchObject({
      dedupeKey: "ai_gap::missing_commercial_content::Quoting",
      dataSource: "ai_visibility",
      action: "new_article",
      impressions: 0,
    });
    const labels = candidate.evidence.map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Prompt group",
        "Competitor in these answers",
        "Collected",
        "Estimated effort",
      ]),
    );
    expect(candidate.evidence.find((e) => e.url)?.url).toBe(
      "https://rival.example/p",
    );
  });
});
