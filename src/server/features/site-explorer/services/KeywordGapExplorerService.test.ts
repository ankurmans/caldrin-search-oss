import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keywordGapQuerySchema } from "@/types/schemas/keyword-gap";
import { runInWorkspace } from "@/server/lib/workspace-scope";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { KeywordGapExplorerService } from "./KeywordGapExplorerService";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  env: { DATAFORSEO_API_KEY: "operator-key" } as Record<string, string>,
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});
vi.mock("@/db/runBatch", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return {
    runBatch: async (
      build: (tx: ReturnType<typeof createProxyDb>) => Promise<unknown>[],
    ) => {
      for (const statement of build(createProxyDb(() => state.database)))
        await statement;
    },
  };
});
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async (name: string) => state.env[name],
  getRequiredEnvValue: async (name: string) => state.env[name] ?? "",
  getWorkersEnv: async () => ({}),
}));
vi.mock("@/server/features/content/services/ContentService", () => ({
  ContentService: {},
}));

const fetchMock = vi.fn<typeof fetch>();

function ctx(projectId = "p1", organizationId = "org-cloud") {
  return { projectId, organizationId, userId: "u1", userEmail: "u@e.com" };
}
const input = (over: Record<string, unknown> = {}) => ({
  competitors: [],
  rowsPerCompetitor: 100,
  includeOutranked: false,
  ...over,
});
const sql = (statement: string) => state.database?.exec(statement);
const all = (statement: string) =>
  state.database?.prepare(statement).all() ?? [];
const query = (over: Record<string, unknown> = {}) =>
  keywordGapQuerySchema.parse(over);

function intersectionResponse(domain: string) {
  const keywords = [
    ["rope swing", 5400, 3],
    ["tree swing seat", 880, 7],
    ["swing hooks", null, 12],
  ] as const;
  return Response.json({
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        path: [
          "v3",
          "dataforseo_labs",
          "google",
          "domain_intersection",
          "live",
        ],
        cost: 0.01,
        result: [
          {
            total_count: 4210,
            items: keywords.map(([keyword, volume, rank]) => ({
              keyword_data: {
                keyword,
                keyword_info: { search_volume: volume },
                keyword_properties:
                  keyword === "swing hooks" ? null : { keyword_difficulty: 30 },
              },
              first_domain_serp_element: {
                rank_group: rank,
                url: `https://${domain}/collections/swings`,
              },
            })),
          },
        ],
      },
    ],
  });
}

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
  sql(
    `insert into projects (id, organization_id, name, domain, location_code, language_code) values
       ('p1', 'org-cloud', 'Shop', 'shop.example.com', 2840, 'en'),
       ('p2', 'org-cloud', 'Other', 'other.example.com', 2840, 'en')`,
  );
  sql(
    `insert into project_competitors (id, project_id, domain, updated_by) values
       ('c1', 'p1', 'rival.com', 'user'), ('c2', 'p1', 'rival2.com', 'user')`,
  );
  sql(
    `insert into workspace_settings (organization_id, mode) values ('org-cloud', 'cloud')`,
  );
  state.env = { DATAFORSEO_API_KEY: "operator-key" };
  fetchMock.mockImplementation(async (url) =>
    intersectionResponse(
      typeof url === "string" && url.includes("rival2")
        ? "rival2.com"
        : "rival.com",
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("keyword gap read", () => {
  it("previews the cost without calling the provider, then reads once per competitor", async () => {
    const quote = await runInWorkspace("org-cloud", () =>
      KeywordGapExplorerService.estimate(ctx(), input()),
    );
    expect(quote).toMatchObject({
      available: true,
      competitors: ["rival.com", "rival2.com"],
      providerReads: 2,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const result = await runInWorkspace("org-cloud", () =>
      KeywordGapExplorerService.run(ctx(), input()),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.rowCount).toBe(3);
    expect(all(`select operation from provider_costs`)).toEqual([
      { operation: "site_explorer_keyword_gap" },
    ]);
    expect(
      all(`select last_analysed_at from project_competitors where id = 'c1'`)[0]
        ?.last_analysed_at,
    ).toEqual(expect.any(String));
  });

  it("merges competitors, reports the provider's own total, and keeps missing values empty", async () => {
    await runInWorkspace("org-cloud", () =>
      KeywordGapExplorerService.run(ctx(), input()),
    );
    const page = await KeywordGapExplorerService.list("p1", query());
    expect(page?.total).toBe(3);
    expect(page?.competitors[0]).toMatchObject({
      rowsRead: 3,
      providerTotal: 4210,
    });
    const hooks = page?.rows.find((row) => row.keyword === "swing hooks");
    expect(hooks).toMatchObject({
      searchVolume: null,
      keywordDifficulty: null,
      competitorCount: 2,
      likelyPageType: "collection",
    });
    // A missing volume sorts last in both directions.
    for (const sortDir of ["asc", "desc"] as const) {
      const sorted = await KeywordGapExplorerService.list(
        "p1",
        query({ sortBy: "searchVolume", sortDir }),
      );
      expect(sorted?.rows.at(-1)?.keyword).toBe("swing hooks");
    }
  });

  it("filters and paginates on the server", async () => {
    await runInWorkspace("org-cloud", () =>
      KeywordGapExplorerService.run(ctx(), input()),
    );
    const filtered = await KeywordGapExplorerService.list(
      "p1",
      query({ minVolume: 1000 }),
    );
    expect(filtered?.rows.map((r) => r.keyword)).toEqual(["rope swing"]);
    const paged = await KeywordGapExplorerService.list(
      "p1",
      query({ pageSize: 10, page: 2 }),
    );
    expect(paged).toMatchObject({ total: 3, rows: [] });
    const search = await KeywordGapExplorerService.list(
      "p1",
      query({ search: "hook_" }),
    );
    // "_" is a literal character, not a wildcard.
    expect(search?.total).toBe(0);
  });

  it("does not show one project's runs to another", async () => {
    await runInWorkspace("org-cloud", () =>
      KeywordGapExplorerService.run(ctx(), input()),
    );
    expect(await KeywordGapExplorerService.list("p2", query())).toBeNull();
    const run = all(`select id from keyword_gap_runs`)[0];
    expect(
      await KeywordGapExplorerService.list(
        "p2",
        query({ runId: String(run?.id) }),
      ),
    ).toBeNull();
  });

  it("refuses more than five competitors and a repeat on the same day", async () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((n) => `${n}.com`);
    const quote = await runInWorkspace("org-cloud", () =>
      KeywordGapExplorerService.estimate(ctx(), input({ competitors: six })),
    );
    expect(quote.available).toBe(false);
    expect(quote.reason).toContain("up to 5");

    await runInWorkspace("org-cloud", () =>
      KeywordGapExplorerService.run(ctx(), input()),
    );
    await expect(
      runInWorkspace("org-cloud", () =>
        KeywordGapExplorerService.run(ctx(), input()),
      ),
    ).rejects.toThrow(/already ran today/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses without reading when the estimate passes the spend limit", async () => {
    sql(
      `insert into project_spend_limits (project_id, daily_usd, updated_by_user_id) values ('p1', 0.001, 'u1')`,
    );
    await expect(
      runInWorkspace("org-cloud", () =>
        KeywordGapExplorerService.run(ctx(), input()),
      ),
    ).rejects.toThrow(/spend limit/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(all(`select id from keyword_gap_runs`)).toHaveLength(0);
  });

  it("keeps a dismissed keyword dismissed when the gap is read again", async () => {
    await runInWorkspace("org-cloud", () =>
      KeywordGapExplorerService.run(ctx(), input()),
    );
    const first = await KeywordGapExplorerService.list("p1", query());
    const hooks = first?.rows.find((row) => row.keyword === "rope swing");
    await KeywordGapExplorerService.decide(ctx(), {
      runId: String(first?.run.id),
      rowIds: [String(hooks?.id)],
      patch: { status: "dismissed" },
    });
    await runInWorkspace("org-cloud", () =>
      KeywordGapExplorerService.run(ctx(), input(), { repeat: true }),
    );
    const open = await KeywordGapExplorerService.list("p1", query());
    expect(open?.rows.map((row) => row.keyword)).not.toContain("rope swing");
    const dismissed = await KeywordGapExplorerService.list(
      "p1",
      query({ status: "dismissed" }),
    );
    expect(dismissed?.rows.map((row) => row.keyword)).toEqual(["rope swing"]);
  });

  it("stores one opportunity per keyword and links it back to the row", async () => {
    await runInWorkspace("org-cloud", () =>
      KeywordGapExplorerService.run(ctx(), input()),
    );
    const page = await KeywordGapExplorerService.list("p1", query());
    const row = page?.rows.find((r) => r.keyword === "tree swing seat");
    const target = { runId: String(page?.run.id), rowId: String(row?.id) };
    const first = await KeywordGapExplorerService.createOpportunity(
      ctx(),
      target,
    );
    const again = await KeywordGapExplorerService.createOpportunity(
      ctx(),
      target,
    );
    expect(again.opportunityId).toBe(first.opportunityId);
    expect(first.action).toBe("create_page");
    expect(all(`select id from content_opportunities`)).toHaveLength(1);
    const linked = await KeywordGapExplorerService.list(
      "p1",
      query({ hasOpportunity: true }),
    );
    expect(linked?.rows.map((r) => r.keyword)).toEqual(["tree swing seat"]);
  });
});
