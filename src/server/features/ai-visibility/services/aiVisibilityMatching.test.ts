import { describe, expect, it } from "vitest";
import type { ParsedAiAnswer } from "../providers/dataforseoEvidence";
import {
  aiMentionSpans,
  aiPromptIsBranded,
  matchAiBrand,
  ownedAiDomain,
} from "./aiVisibilityMatching";

const brand = { name: "Acme", domain: "caldrin.co", own: true };
function answer(text: string, citedHosts: string[] = []): ParsedAiAnswer {
  return {
    answerMarkdown: text,
    answerText: text,
    citations: citedHosts.map((domain, index) => ({
      url: `https://${domain}/guide`,
      domain,
      title: null,
      position: index + 1,
      origin: "provider_source" as const,
    })),
    queries: null,
    retrievals: null,
    products: [],
    collectedAt: null,
    model: null,
  };
}

describe("brand mentions", () => {
  it.each([
    ["Acme is an open-source toolkit.", 0],
    ["Acme's MCP supports research.", 0],
    ["Try caldrin.co for audits.", 4],
    ["Acmesomething and MyAcme are different names.", null],
    ["Links: https://caldrin.co/Acme and www.caldrin.co/Acme", null],
    ["Email Acme@example.com or help@caldrin.co.", null],
    ["An unrelated toolkit has similar features.", null],
  ])("%s", (text, firstMention) => {
    expect(matchAiBrand(answer(text), brand)).toMatchObject({
      mentioned: firstMention !== null,
      firstMention,
    });
  });

  it.each([
    ["acmeride.com", true],
    ["shop.acmeride.com", false],
  ])("bare name mentions a brand named %s: %s", (domain, mentioned) => {
    const text = "- [Acmeride](https://www.acmeride.com/): Connects directly.";
    expect(
      matchAiBrand(answer(text), { name: domain, domain, own: true }).mentioned,
    ).toBe(mentioned);
  });

  it("matches a competitor named Default, but not a project named Default", () => {
    const text = "Default is the default choice.";
    const named = { name: "Default", domain: "acme.com" };
    expect(matchAiBrand(answer(text), { ...named, own: false }).mentioned).toBe(
      true,
    );
    expect(matchAiBrand(answer(text), { ...named, own: true }).mentioned).toBe(
      false,
    );
  });

  it("returns original UTF-16 offsets through emoji and both Unicode accent forms", () => {
    const text = "🔎 Café and Café are the same spelling.";
    const spans = aiMentionSpans(text, ["Café"]);
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual([
      "Café",
      "Café",
    ]);
    expect(spans[0]).toEqual({ start: 3, end: 7 });
  });

  it("escapes regex syntax and keeps the longest overlapping name", () => {
    const text = "C++ Tools and Open SEO Tools";
    expect(
      aiMentionSpans(text, ["C++ Tools", "Open SEO", "Open SEO Tools"]).map(
        (s) => text.slice(s.start, s.end),
      ),
    ).toEqual(["C++ Tools", "Open SEO Tools"]);
  });
});

describe("brand citations", () => {
  it.each(["caldrin.co", "www.caldrin.co", "docs.caldrin.co"])(
    "counts a cited page on %s",
    (host) => {
      expect(matchAiBrand(answer("Other tools.", [host]), brand)).toMatchObject(
        { mentioned: false, cited: true },
      );
    },
  );
  it.each(["caldrin.co.evil.example", "notcaldrin.co", "acme.com"])(
    "does not count %s",
    (host) => {
      expect(ownedAiDomain(host, brand.domain)).toBe(false);
      expect(matchAiBrand(answer("Other tools.", [host]), brand).cited).toBe(
        false,
      );
    },
  );
});

describe("branded prompt cohort", () => {
  it.each([
    "What is Acme?",
    "Review https://caldrin.co",
    "What does www.caldrin.co offer?",
    "Review docs.caldrin.co/mcp",
  ])("includes %s", (prompt) => {
    expect(aiPromptIsBranded(prompt, brand)).toBe(true);
  });
  it.each([
    "Best open source SEO tools?",
    "Review https://caldrin.co.evil.example",
    "Review https://notcaldrin.co",
  ])("excludes %s", (prompt) => {
    expect(aiPromptIsBranded(prompt, brand)).toBe(false);
  });
  it("never treats the word default as a project named Default", () => {
    const named = { name: "Default", domain: "acme.com" };
    expect(aiPromptIsBranded("What is the default setting?", named)).toBe(
      false,
    );
    expect(aiPromptIsBranded("Review acme.com", named)).toBe(true);
  });
});

describe("recommendations", () => {
  it("marks the brand named in an explicit recommendation and leaves another unmentioned brand null", () => {
    const text = "I recommend Acme Tools.";
    expect(
      matchAiBrand(answer(text), {
        name: "Acme Tools",
        domain: "acme.com",
        own: true,
      }),
    ).toMatchObject({ mentioned: true, recommended: true });
    expect(
      matchAiBrand(answer(text), {
        name: "Other",
        domain: "other.com",
        own: false,
      }),
    ).toMatchObject({ mentioned: false, recommended: null });
  });
});
