import { describe, expect, it } from "vitest";
import { answerEvidence } from "./aiAnswerEvidence";

const brand = (name: string, domain: string, own = false) => ({
  name,
  domain,
  own,
  mentioned: true,
  cited: false,
  firstMention: null,
  recommended: null,
});
const source = (url: string, position = 1) => ({
  url,
  domain: new URL(url).hostname,
  title: null,
  position,
});
const words = (text: string, spans: { start: number; end: number }[]) =>
  spans.map((s) => text.slice(s.start, s.end));

describe("answer evidence", () => {
  it("highlights a brand by its name, its domain, and a domain-named brand by its stem", () => {
    const text = "Bean & Barrel (beanbarrel.com) beats Acme. See acme.io.";
    const { mentions } = answerEvidence(
      text,
      Infinity,
      [
        brand("Bean & Barrel", "beanbarrel.com", true),
        brand("acme.io", "acme.io"),
      ],
      [],
    );
    expect(mentions.map((m) => words(text, m.spans))).toEqual([
      ["Bean & Barrel", "beanbarrel.com"],
      ["Acme", "acme.io"],
    ]);
  });

  it("marks cited text only where the URL or domain is written out", () => {
    const text =
      "Read https://acme.io/guide or acme.io, not acme.io.evil.net or notacme.io.";
    const { citedTextSpans } = answerEvidence(
      text,
      Infinity,
      [],
      [source("https://acme.io/guide"), source("https://www.other.com/x", 2)],
    );
    expect(citedTextSpans).toMatchObject([
      { domain: "acme.io", positions: [1] },
      { domain: "acme.io", positions: [1] },
    ]);
    expect(words(text, citedTextSpans)).toEqual([
      "https://acme.io/guide",
      "acme.io",
    ]);
  });

  it("notes a stem-only match, words two brands share, and a missing verdict", () => {
    const text = "Acme Cloud is popular.";
    const { ambiguities } = answerEvidence(
      text,
      Infinity,
      [brand("acme.com", "acme.com"), brand("Acme Cloud", "acmecloud.io")],
      [],
    );
    expect(ambiguities).toEqual([
      expect.stringContaining("matched only by the word “acme”"),
      expect.stringContaining("“Acme Cloud” is matched by both"),
      expect.stringContaining(
        "No explicit recommendation wording was found for acme.com, Acme Cloud",
      ),
    ]);
  });
});
