import { describe, expect, it } from "vitest";
import type { DomainIntersectionItem } from "@/server/lib/dataforseo/backlinksIntersection";
import { mergeLinkGapReads } from "./linkGapMerge";

function item(
  entries: Record<
    string,
    { target: string; rank?: number; backlinks?: number }
  >,
): DomainIntersectionItem {
  return { domain_intersection: entries };
}

const options = {
  own: "mysite.com",
  competitors: ["a.com", "b.com"],
  runAt: "2026-11-20T00:00:00.000Z",
};

describe("mergeLinkGapReads", () => {
  it("counts the competitors a referring domain links to across reads", () => {
    const merged = mergeLinkGapReads(
      [
        {
          competitors: ["a.com", "b.com"],
          items: [
            item({
              "1": { target: "news.com", rank: 40, backlinks: 3 },
              "2": { target: "news.com", rank: 55, backlinks: 5 },
            }),
          ],
        },
        // The same domain read again for one competitor must not double count.
        {
          competitors: ["a.com"],
          items: [item({ "1": { target: "news.com", rank: 40 } })],
        },
        {
          competitors: ["b.com"],
          items: [item({ "1": { target: "solo.org", rank: 90 } })],
        },
      ],
      options,
    );

    expect(merged.map((c) => [c.referringDomain, c.competitorCount])).toEqual([
      ["news.com", 2],
      ["solo.org", 1],
    ]);
    expect(merged[0]?.domainRank).toBe(55);
  });

  it("drops the user's own site, its subdomains and the compared competitors", () => {
    const merged = mergeLinkGapReads(
      [
        {
          competitors: ["a.com", "b.com"],
          items: [
            item({ "1": { target: "mysite.com" } }),
            item({ "1": { target: "blog.mysite.com" } }),
            item({ "1": { target: "b.com" } }),
            item({ "1": { target: "www.Real-Site.com" } }),
          ],
        },
      ],
      options,
    );

    expect(merged.map((c) => c.referringDomain)).toEqual(["real-site.com"]);
  });
});
