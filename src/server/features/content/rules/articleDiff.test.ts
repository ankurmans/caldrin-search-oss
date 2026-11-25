import { describe, expect, it } from "vitest";
import { diffArticles, renderArticleState } from "./articleDiff";

const base = {
  title: "Pour over guide",
  bodyHtml: "<p>One</p><p>Two</p><p>Three</p><p>Four</p><p>Five</p><p>Six</p>",
  metaTitle: "Pour over",
  metaDescription: "How to brew.",
};

describe("diffArticles", () => {
  it("shows a new article as all additions", () => {
    const diff = diffArticles(null, base);
    expect(diff.unchanged).toBe(false);
    expect(diff.linesRemoved).toBe(0);
    expect(diff.linesAdded).toBe(6);
    expect(diff.text).toContain("+ Title: Pour over guide");
  });

  it("shows only the changed field and body line, with context", () => {
    const after = {
      ...base,
      title: "The pour over guide",
      bodyHtml: base.bodyHtml.replace("<p>Four</p>", "<p>Four, revised</p>"),
    };
    const diff = diffArticles(base, after);
    expect(diff.changes.map((c) => c.field)).toEqual(["title", "bodyHtml"]);
    expect(diff.linesAdded).toBe(1);
    expect(diff.linesRemoved).toBe(1);
    expect(diff.text).toContain("- Title: Pour over guide");
    expect(diff.text).toContain("+ Title: The pour over guide");
    expect(diff.text).toContain("- <p>Four</p>");
    expect(diff.text).toContain("+ <p>Four, revised</p>");
    // Lines far from the change are elided, not repeated.
    expect(diff.text).not.toContain("<p>One</p>");
    expect(diff.text).toContain("...");
  });

  it("reports a status flip and nothing else for a publish", () => {
    const diff = diffArticles(
      { ...base, isPublished: false },
      { ...base, isPublished: true },
    );
    expect(diff.changes.map((c) => c.field)).toEqual(["isPublished"]);
    expect(diff.text).toBe("- Status: draft (not public)\n+ Status: published");
  });

  it("says so when nothing changes", () => {
    expect(diffArticles(base, base)).toMatchObject({
      unchanged: true,
      text: "No changes.",
    });
  });

  it("renders equal content to equal text, so drift is detectable", () => {
    expect(renderArticleState(base, "gid://a")).toBe(
      renderArticleState({ ...base }, "gid://a"),
    );
    expect(renderArticleState(base, "gid://a")).not.toBe(
      renderArticleState({ ...base, metaTitle: "x" }, "gid://a"),
    );
  });
});
