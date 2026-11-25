import { describe, expect, it } from "vitest";
import {
  rankOwnerCandidates,
  scoreOwnerCandidate,
  selectOwner,
} from "./ownerPageSelector";

const PROMPT =
  "Which transcription tool is pay as you go with no subscription?";
const site = "https://pepys.example";

describe("owner page selection", () => {
  it("picks the page that covers the prompt and leaves the front page out", () => {
    const ranked = rankOwnerCandidates(PROMPT, [
      { url: `${site}/`, title: "Pepys transcription" },
      { url: `${site}/blog/office-chairs`, title: "Office chairs" },
      {
        url: `${site}/best/pay-as-you-go-transcription`,
        title: "Pay as you go transcription with no subscription",
      },
    ]);
    expect(ranked[0].url).toBe(`${site}/best/pay-as-you-go-transcription`);
    expect(ranked.map((c) => c.url)).not.toContain(`${site}/`);
    const selection = selectOwner(PROMPT, ranked, null);
    expect(selection.selected?.url).toBe(ranked[0].url);
    expect(selection.overridden).toBe(false);
  });

  it("selects nothing, rather than a weak page, when no page fits", () => {
    const ranked = rankOwnerCandidates(PROMPT, [
      { url: `${site}/blog/office-chairs`, title: "Office chairs" },
    ]);
    const selection = selectOwner(PROMPT, ranked, null);
    expect(selection.selected).toBeNull();
    expect(selection.notes.join(" ")).toMatch(/under the/);
  });

  it("trusts a page a person chose, and says so", () => {
    const chosen = `${site}/blog/office-chairs`;
    const selection = selectOwner(PROMPT, [], {
      url: chosen,
      candidate: scoreOwnerCandidate(PROMPT, { url: chosen }),
    });
    expect(selection).toMatchObject({ overridden: true, confidence: null });
    expect(selection.selected?.url).toBe(chosen);
  });

  it("still prefers the how-to guide when the prompt asks how to do something", () => {
    const ranked = rankOwnerCandidates("How do I dictate on a Mac?", [
      {
        url: `${site}/dictate/guides/how-to-dictate-on-mac`,
        title: "How to Dictate on a Mac: Voice Typing Steps",
      },
      {
        url: `${site}/dictate/best-dictation-apps`,
        title: "Best Dictation Apps and Software (2026)",
      },
    ]);
    expect(ranked[0].url).toBe(`${site}/dictate/guides/how-to-dictate-on-mac`);
  });
});
