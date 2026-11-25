import { describe, expect, it } from "vitest";
import {
  aggregateGscRows,
  observationsFromTotals,
  pageFilterFor,
  planGscWindows,
} from "./gscWindows";

const NOW = new Date("2026-11-16T10:00:00Z");

describe("planGscWindows", () => {
  it("measures 28 days before the change and 28 days ending 3 days ago", () => {
    const plan = planGscWindows("2026-10-01T12:00:00Z", NOW);
    expect(plan?.baseline).toEqual({ start: "2026-09-03", end: "2026-09-30" });
    expect(plan?.baselineReady).toBe(true);
    expect(plan?.followUp).toEqual({
      status: "ready",
      window: { start: "2026-10-17", end: "2026-11-13" },
      daysBeforeChange: 0,
    });
  });

  it("says how much of a follow-up window predates a young change", () => {
    const plan = planGscWindows("2026-11-01T12:00:00Z", NOW);
    expect(plan?.followUp).toMatchObject({
      status: "ready",
      daysBeforeChange: 15,
    });
  });

  it("is too early for a follow-up inside 7 days, with the date it opens", () => {
    const plan = planGscWindows("2026-11-15T12:00:00Z", NOW);
    expect(plan?.followUp).toEqual({
      status: "too_early",
      readyOn: "2026-11-22",
    });
    // Search Console has not published the days just before the change.
    expect(plan?.baselineReady).toBe(false);
  });

  it("refuses an unreadable execution time", () => {
    expect(planGscWindows("not a date", NOW)).toBeNull();
  });
});

describe("page filter and totals", () => {
  it("narrows a path match to the exact page", () => {
    const { filter, keepRow } = pageFilterFor(
      "https://shop.example/blogs/news/post/",
    );
    expect(filter).toEqual({
      operator: "contains",
      expression: "/blogs/news/post",
    });
    expect(keepRow("https://example.com/blogs/news/post")).toBe(true);
    expect(keepRow("https://shop.example/blogs/news/post-2")).toBe(false);
  });

  it("does not turn a home page into a whole-site filter", () => {
    const { filter } = pageFilterFor("https://shop.example/");
    expect(filter.operator).toBe("equals");
  });

  it("returns no totals, not zeros, when a window has no impressions", () => {
    expect(aggregateGscRows([])).toBeNull();
  });

  it("keeps the parts behind each rate", () => {
    const totals = aggregateGscRows([
      { clicks: 10, impressions: 100, position: 4 },
      { clicks: 10, impressions: 300, position: 8 },
    ]);
    const drafts = observationsFromTotals(totals!);
    expect(drafts.find((d) => d.metric === "ctr")).toMatchObject({
      value: 0.05,
      numerator: 20,
      denominator: 400,
    });
    expect(drafts.find((d) => d.metric === "position")).toMatchObject({
      value: 7,
      denominator: 400,
    });
  });
});
