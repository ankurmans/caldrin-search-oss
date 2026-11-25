import { beforeEach, describe, expect, it, vi } from "vitest";
import { GscService } from "@/server/features/gsc/services/GscService";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import { ATTRIBUTION_NOTE, LedgerRefusal } from "../types";
import { LedgerService } from "./LedgerService";
import {
  approved,
  executed,
  resetDatabase,
  scopeA,
  setEntryColumn,
} from "./ledgerTestSupport";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => (await import("./ledgerDb")).ledgerDbMock());
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: vi.fn() },
}));

const NOW = new Date("2026-11-16T10:00:00Z");

beforeEach(() => {
  resetDatabase();
  vi.mocked(GscService.getPerformance).mockResolvedValue({
    siteUrl: "sc-domain:example.com",
    connectedBy: null,
    request: { startDate: "", endDate: "" },
    rows: [],
  });
});

const row = (
  page: string,
  clicks: number,
  impressions: number,
  position: number,
) => ({
  keys: [page],
  clicks,
  impressions,
  ctr: clicks / impressions,
  position,
});

function rejection(promise: Promise<unknown>) {
  return expect(promise).rejects.toBeInstanceOf(LedgerRefusal);
}

describe("observations", () => {
  it("keeps numerator and denominator and never claims causation", async () => {
    const entry = await executed();
    await LedgerService.recordObservation(scopeA, entry.id, {
      phase: "follow_up",
      source: "ai_visibility",
      metric: "citation_rate",
      value: 0.25,
      numerator: 5,
      denominator: 20,
      aiRunId: "run-1",
    });
    const detail = await LedgerService.getEntry("project-a", entry.id);
    expect(detail.observations).toEqual([
      expect.objectContaining({ value: 0.25, numerator: 5, denominator: 20 }),
    ]);
    expect(detail.attribution).toBe("observed_only");
    expect(detail.attributionNote).toBe(ATTRIBUTION_NOTE);
  });

  it("rejects a rate with a zero denominator", async () => {
    const entry = await executed();
    await rejection(
      LedgerService.recordObservation(scopeA, entry.id, {
        phase: "baseline",
        source: "manual",
        metric: "rate",
        value: 0,
        numerator: 0,
        denominator: 0,
      }),
    );
  });
});

describe("Search Console collection", () => {
  async function executedLongAgo() {
    const entry = await executed();
    setEntryColumn(entry.id, "executed_at", "2026-10-01T12:00:00.000Z");
    return entry;
  }

  it("records both windows once, only for the exact page", async () => {
    const entry = await executedLongAgo();
    vi.mocked(GscService.getPerformance).mockResolvedValue({
      siteUrl: "x",
      connectedBy: null,
      request: { startDate: "", endDate: "" },
      rows: [
        row("https://shop.example/blogs/news/post", 20, 400, 7),
        row("https://shop.example/blogs/news/post-2", 99, 999, 1),
      ],
    });
    const first = await LedgerService.collectGscObservations(
      scopeA,
      entry.id,
      NOW,
    );
    expect(first.baseline).toMatchObject({ status: "recorded", recorded: 4 });
    expect(first.followUp).toMatchObject({ status: "recorded", recorded: 4 });
    const again = await LedgerService.collectGscObservations(
      scopeA,
      entry.id,
      NOW,
    );
    expect(again.baseline.status).toBe("already_recorded");

    const detail = await LedgerService.getEntry("project-a", entry.id);
    expect(detail.observations).toHaveLength(8);
    expect(detail.observations.find((o) => o.metric === "ctr")).toMatchObject({
      value: 0.05,
      numerator: 20,
      denominator: 400,
    });
    expect(detail.entry).toMatchObject({
      baselineStart: "2026-09-03",
      baselineEnd: "2026-09-30",
    });
  });

  it("records nothing when Search Console has no data or is not connected", async () => {
    const entry = await executedLongAgo();
    const empty = await LedgerService.collectGscObservations(
      scopeA,
      entry.id,
      NOW,
    );
    expect(empty.baseline.status).toBe("no_data");
    expect(empty.followUp.status).toBe("no_data");

    vi.mocked(GscService.getPerformance).mockRejectedValue(
      new GscNotConnectedError("project-a"),
    );
    const offline = await LedgerService.collectGscObservations(
      scopeA,
      entry.id,
      NOW,
    );
    expect(offline.followUp.status).toBe("unavailable");
    const detail = await LedgerService.getEntry("project-a", entry.id);
    expect(detail.observations).toEqual([]);
  });

  it("holds the follow-up until the change is 7 days old", async () => {
    const entry = await executed();
    setEntryColumn(entry.id, "executed_at", "2026-11-10T12:00:00.000Z");
    const result = await LedgerService.collectGscObservations(
      scopeA,
      entry.id,
      NOW,
    );
    expect(result.followUp).toMatchObject({ status: "too_early", recorded: 0 });
    expect(GscService.getPerformance).toHaveBeenCalledTimes(1);
  });

  it("measures only a published change", async () => {
    const entry = await approved();
    await LedgerService.beginExecution(scopeA, entry.id);
    await LedgerService.recordExecution(scopeA, entry.id, {
      publicationStatus: "draft",
    });
    await rejection(
      LedgerService.collectGscObservations(scopeA, entry.id, NOW),
    );
  });
});
