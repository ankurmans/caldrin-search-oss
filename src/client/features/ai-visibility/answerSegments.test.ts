import { describe, expect, it } from "vitest";
import { segmentAnswer, type AnswerMark } from "./answerSegments";

const mention: AnswerMark = {
  kind: "mention",
  domain: "acme.com",
  label: "Acme",
  own: true,
};
const cited: AnswerMark = { kind: "cited", domain: "acme.com", positions: [1] };
const verdict: AnswerMark = {
  kind: "recommendation",
  label: "Acme",
  verdict: true,
};

describe("segmentAnswer", () => {
  it("splits overlapping highlights into segments carrying every mark that covers them", () => {
    const text = "Try acme.com today";
    const segments = segmentAnswer(text, [
      { start: 4, end: 12, mark: mention },
      { start: 4, end: 12, mark: cited },
      { start: 0, end: 8, mark: verdict },
    ]);
    expect(segments).toEqual([
      { text: "Try ", marks: [verdict] },
      { text: "acme", marks: [mention, cited, verdict] },
      { text: ".com", marks: [mention, cited] },
      { text: " today", marks: [] },
    ]);
    expect(segments.map((s) => s.text).join("")).toBe(text);
  });
});
