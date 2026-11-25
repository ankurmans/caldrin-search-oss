import { describe, expect, it } from "vitest";
import { activeSiteExplorerTab } from "./siteExplorerTabs";

const base = "/p/p1";

describe("activeSiteExplorerTab", () => {
  it.each([
    [`${base}/keyword-gap`, {}, "keyword-gap"],
    [`${base}/competitors`, {}, "competitors"],
    [`${base}/brand-lookup`, {}, "ai"],
    [`${base}/domain`, {}, "overview"],
    [`${base}/domain`, { view: "backlinks" }, "backlinks"],
    [`${base}/domain`, { view: "ai" }, "ai"],
    [`${base}/domain`, { view: "nonsense" }, "overview"],
  ])("lights the right tab for %s %o", (pathname, search, tab) => {
    expect(activeSiteExplorerTab(pathname, "p1", search)).toBe(tab);
  });

  it("lights Organic for a legacy keyword-table link", () => {
    expect(
      activeSiteExplorerTab(`${base}/domain`, "p1", { sort: "volume" }),
    ).toBe("organic");
  });
});
