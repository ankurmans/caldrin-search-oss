import { sort } from "remeda";
import { describe, expect, it } from "vitest";
import {
  aiBrandNames,
  aiMentionSpans,
} from "@/server/features/ai-visibility/services/aiVisibilityMatching";
import { GOLD_SET } from "./perceptionGoldSet";

const sorted = (xs: string[]) => sort(xs, (a, b) => a.localeCompare(b));

describe("perception quality-gate set", () => {
  it("labels every brand the text names, and only those", () => {
    for (const c of GOLD_SET) {
      const named = c.brands
        .filter((b) => aiMentionSpans(c.text, aiBrandNames(b)).length)
        .map((b) => b.domain);
      expect(sorted(c.expected.map((e) => e.domain)), c.id).toEqual(
        sorted(named),
      );
    }
  });

  it("has unique ids and covers every stance", () => {
    expect(new Set(GOLD_SET.map((c) => c.id)).size).toBe(GOLD_SET.length);
    const stances = new Set(
      GOLD_SET.flatMap((c) => c.expected.map((e) => e.stance)),
    );
    expect(sorted([...stances])).toEqual([
      "described",
      "discouraged",
      "recommended",
    ]);
  });
});
