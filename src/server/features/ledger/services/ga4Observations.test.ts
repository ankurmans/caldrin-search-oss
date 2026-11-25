import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGa4DataClient,
  type Ga4RunReportRequest,
  type Ga4RunReportResponse,
} from "@/server/lib/ga4Client";
import { Ga4TokenError } from "@/server/lib/ga4Errors";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { ATTRIBUTION_NOTE, LedgerRefusal } from "../types";
import { collectGa4Observations } from "./ga4Observations";
import {
  NOW,
  rows,
  seedEntry,
  seedGa4Connection,
} from "./scheduledTestSupport";

const state = vi.hoisted(() => ({ database: null as DatabaseSync | null }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});
vi.mock("@/server/lib/ga4Client", () => ({ createGa4DataClient: vi.fn() }));

const runReport =
  vi.fn<(request: Ga4RunReportRequest) => Promise<Ga4RunReportResponse>>();
const database = () => {
  if (!state.database) throw new Error("no database");
  return state.database;
};

// Answers the two reports a window needs: the changed page, and the
// property-wide "does it sell anything" probe (the one without dimensions).
function answer(opts: {
  pageRows?: [string, number, number, number][];
  propertyTransactions?: number;
}) {
  runReport.mockImplementation(async (request) => {
    if (request.dimensions.length === 0) {
      return opts.propertyTransactions === undefined
        ? {}
        : {
            metricHeaders: [{ name: "transactions" }],
            rows: [
              { metricValues: [{ value: `${opts.propertyTransactions}` }] },
            ],
          };
    }
    if (!opts.pageRows) return {};
    return {
      dimensionHeaders: [{ name: "landingPage" }],
      metricHeaders: [
        { name: "sessions" },
        { name: "transactions" },
        { name: "purchaseRevenue" },
      ],
      rows: opts.pageRows.map(([page, sessions, transactions, revenue]) => ({
        dimensionValues: [{ value: page }],
        metricValues: [
          { value: `${sessions}` },
          { value: `${transactions}` },
          { value: `${revenue}` },
        ],
      })),
    };
  });
}

const stored = (entryId: string) =>
  rows(
    database(),
    `SELECT metric, phase, source, value, numerator, denominator, note FROM change_ledger_observations WHERE entry_id = '${entryId}' ORDER BY phase, metric`,
  );

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
  seedEntry(database(), {
    id: "post",
    targetUrl: "https://shop.example/blogs/news/post",
  });
  seedGa4Connection(database(), "project-a");
  vi.mocked(createGa4DataClient).mockReturnValue({ runReport });
  answer({
    pageRows: [
      ["/blogs/news/post", 100, 4, 250.5],
      ["/blogs/news/post-2", 999, 99, 9999],
    ],
    propertyTransactions: 40,
  });
});

const collect = () =>
  collectGa4Observations({ projectId: "project-a", entryId: "post", now: NOW });

describe("Google Analytics observations", () => {
  it("records organic sessions and ecommerce for the exact page, once", async () => {
    const first = await collect();
    expect(first.baseline).toMatchObject({ status: "recorded", recorded: 4 });
    expect(first.followUp).toMatchObject({ status: "recorded", recorded: 4 });
    expect(first.attribution).toBe("observed_only");
    expect(first.attributionNote).toBe(ATTRIBUTION_NOTE);

    const followUp = stored("post").filter((o) => o.phase === "follow_up");
    expect(followUp.every((o) => o.source === "ga4")).toBe(true);
    expect(
      followUp.find((o) => o.metric === "ga4_organic_sessions"),
    ).toMatchObject({
      value: 100,
    });
    expect(
      followUp.find((o) => o.metric === "ga4_ecommerce_revenue"),
    ).toMatchObject({
      value: 250.5,
    });
    expect(
      followUp.find((o) => o.metric === "ga4_organic_transaction_rate"),
    ).toMatchObject({ value: 0.04, numerator: 4, denominator: 100 });

    expect((await collect()).baseline.status).toBe("already_recorded");
    expect(stored("post")).toHaveLength(8);
  });

  it("leaves revenue out when the property records no purchases", async () => {
    answer({
      pageRows: [["/blogs/news/post", 100, 0, 0]],
      propertyTransactions: 0,
    });
    await collect();
    const metrics = stored("post").map((o) => o.metric);
    expect(new Set(metrics)).toEqual(new Set(["ga4_organic_sessions"]));
    expect(stored("post")[0]?.note).toContain("revenue is not reported");
  });

  it("reports no data instead of storing a zero", async () => {
    answer({ pageRows: [], propertyTransactions: 40 });
    const result = await collect();
    expect(result.baseline.status).toBe("no_data");
    expect(result.followUp.status).toBe("no_data");
    expect(stored("post")).toEqual([]);
  });

  it("reports unavailable when Analytics is not connected or the grant is gone", async () => {
    runReport.mockRejectedValue(new Ga4TokenError("revoked"));
    const revoked = await collect();
    expect(revoked.followUp.status).toBe("unavailable");
    expect(revoked.followUp.note).toContain("expired or was revoked");

    database().prepare("DELETE FROM ga4_connections").run();
    const missing = await collect();
    expect(missing.followUp.status).toBe("unavailable");
    expect(missing.followUp.note).toContain("Connect Google Analytics");
    expect(stored("post")).toEqual([]);
  });

  it("holds the follow-up until the change is a week old", async () => {
    database()
      .prepare("UPDATE change_ledger_entries SET executed_at = ?")
      .run("2026-11-12T12:00:00.000Z");
    const result = await collect();
    expect(result.followUp).toMatchObject({ status: "too_early", recorded: 0 });
    expect(runReport).toHaveBeenCalledTimes(2);
  });

  it("refuses a change that was rolled back", async () => {
    database()
      .prepare("UPDATE change_ledger_entries SET status = 'rolled_back'")
      .run();
    await expect(collect()).rejects.toBeInstanceOf(LedgerRefusal);
  });
});
