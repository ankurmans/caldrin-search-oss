import { describe, expect, it } from "vitest";
import { activeHubTab, hubForPath } from "./hubs";

const P = "p1";
const tabOf = (path: string) => {
  const hub = hubForPath(`/p/${P}/${path}`, P);
  return activeHubTab(hub?.tabs ?? [], `/p/${P}/${path}`, P)?.label;
};

describe("AI Search tabs", () => {
  it.each([
    ["ai-visibility/insights", "Visibility"],
    ["ai-visibility/perception", "Perception"],
    ["ai-visibility/citations", "Sources"],
    ["ai-visibility/sources", "Sources"],
    ["ai-visibility", "Prompts"],
    ["ai-visibility/research", "Prompts"],
    ["prompt-explorer", "Prompts"],
    ["ai-visibility/facts", "Brand facts"],
  ])("puts %s under %s", (path, tab) => {
    expect(tabOf(path)).toBe(tab);
  });
});

describe("Technical SEO tabs", () => {
  it.each([
    ["audit", "Site audit"],
    ["audit/issues/r1", "Site audit"],
    ["technical/ai-crawlers", "AI crawlers"],
    ["technical/indexing", "Indexing"],
  ])("puts %s under %s", (path, tab) => {
    expect(tabOf(path)).toBe(tab);
  });
});
