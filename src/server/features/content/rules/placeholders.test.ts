import { describe, expect, it } from "vitest";
import { fillPlaceholders, findPlaceholders, mergeFacts } from "./placeholders";

const html =
  "<p>[MERCHANT TO ADD: Mongoose ATV Quad recommended age]</p><p>[MERCHANT TO ADD: Mongoose ATV Quad recommended age]</p><p>[MERCHANT TO ADD: Forklift weight limit]</p>";

describe("answering draft gaps", () => {
  it("lists each gap once and fills only the answered ones", () => {
    expect(findPlaceholders(html)).toEqual([
      "Mongoose ATV Quad recommended age",
      "Forklift weight limit",
    ]);
    const filled = fillPlaceholders(html, [
      { question: "Mongoose ATV Quad recommended age", answer: "8 & up" },
    ]);
    expect(filled).toBe(
      "<p>8 &amp; up</p><p>8 &amp; up</p><p>[MERCHANT TO ADD: Forklift weight limit]</p>",
    );
  });

  it("replaces an older answer to the same question when saving facts", () => {
    const first = mergeFacts("", [
      { question: "Forklift weight limit", answer: "100 lb" },
    ]);
    const next = mergeFacts(first, [
      { question: "forklift weight limit", answer: "110 lb" },
    ]);
    expect(next).toBe("- Forklift weight limit: 110 lb");
  });
});
