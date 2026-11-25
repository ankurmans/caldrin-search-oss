import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkGapQuerySchema } from "@/types/schemas/link-acquisition";
import { runInWorkspace } from "@/server/lib/workspace-scope";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { LinkEvidenceService } from "./LinkEvidenceService";
import { LinkGapService } from "./LinkGapService";

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

function ctx(projectId = "p1") {
  return {
    projectId,
    organizationId: "org-cloud",
    userId: "u1",
    userEmail: "u@e.com",
  };
}
const input = (over: Record<string, unknown> = {}) => ({
  competitors: [],
  mode: "partial" as const,
  includeSingle: false,
  linkStatus: "live" as const,
  includeSubdomains: true,
  rowLimit: 100,
  ...over,
});
const query = (over: Record<string, unknown> = {}) =>
  linkGapQuerySchema.parse(over);
const all = (statement: string) =>
  state.database?.prepare(statement).all() ?? [];

const entry = (target: string, rank: number) => ({
  target,
  rank,
  backlinks: 3,
  referring_pages: 2,
  backlinks_spam_score: 5,
  first_seen: "2025-01-02 00:00:00 +00:00",
});

function task(path: string[], items: unknown[]) {
  return Response.json({
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        path,
        cost: 0.02,
        result: [{ total_count: items.length, items }],
      },
    ],
  });
}

// Shared read of rival.com + rival2.com: swingblog.com links to both, the
// project's own site and a compared competitor come back as referrers too.
const sharedItems = [
  {
    domain_intersection: {
      "1": entry("swingblog.com", 400),
      "2": entry("swingblog.com", 400),
    },
  },
  { domain_intersection: { "1": entry("shop.example.com", 900) } },
  { domain_intersection: { "2": entry("rival.com", 500) } },
  { domain_intersection: { "1": entry("newsdaily.com", 300) } },
];

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
  state.database?.exec(
    `insert into projects (id, organization_id, name, domain, location_code, language_code) values
       ('p1', 'org-cloud', 'Shop', 'shop.example.com', 2840, 'en'),
       ('p2', 'org-cloud', 'Other', 'other.example.com', 2840, 'en');
     insert into project_competitors (id, project_id, domain, updated_by) values
       ('c1', 'p1', 'rival.com', 'user'), ('c2', 'p1', 'rival2.com', 'user');
     insert into workspace_settings (organization_id, mode) values ('org-cloud', 'cloud')`,
  );
  state.env = { DATAFORSEO_API_KEY: "operator-key" };
  fetchMock.mockImplementation(async (url) =>
    String(url instanceof Request ? url.url : url).includes(
      "domain_intersection",
    )
      ? task(["v3", "backlinks", "domain_intersection", "live"], sharedItems)
      : task(
          ["v3", "backlinks", "backlinks", "live"],
          [
            {
              type: "backlink",
              domain_from: "swingblog.com",
              url_from: "https://swingblog.com/best-swings",
              url_to: "https://rival.com/swings",
              anchor: "rope swings",
              attributes: ["sponsored"],
              dofollow: false,
              page_from_title: "Best swings",
            },
          ],
        ),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("link gap", () => {
  it("previews the cost without a provider call, then reads once for the shared set", async () => {
    const quote = await runInWorkspace("org-cloud", () =>
      LinkGapService.estimate(ctx(), input()),
    );
    expect(quote).toMatchObject({
      available: true,
      competitors: ["rival.com", "rival2.com"],
      providerReads: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const result = await runInWorkspace("org-cloud", () =>
      LinkGapService.run(ctx(), input()),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ rowCount: 2, partial: false });
    expect(all(`select operation from provider_costs`)).toEqual([
      { operation: "link_gap" },
    ]);
  });

  it("asks the provider for no more than three sort rules, however many competitors", async () => {
    state.database?.exec(
      `insert into project_competitors (id, project_id, domain, updated_by) values
         ('c3', 'p1', 'rival3.com', 'user'), ('c4', 'p1', 'rival4.com', 'user'),
         ('c5', 'p1', 'rival5.com', 'user')`,
    );
    await runInWorkspace("org-cloud", () =>
      LinkGapService.run(
        ctx(),
        input({
          competitors: [
            "rival.com",
            "rival2.com",
            "rival3.com",
            "rival4.com",
            "rival5.com",
          ],
        }),
      ),
    );
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    const sent = z
      .array(z.object({ order_by: z.array(z.string()) }))
      .parse(JSON.parse(typeof body === "string" ? body : "[]"));
    expect(sent[0]?.order_by).toHaveLength(3);
  });

  it("keeps the provider's reason when every read is refused", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({
        status_code: 20000,
        tasks: [
          {
            status_code: 40501,
            status_message: "Invalid Field: 'order_by'.",
            path: ["v3", "backlinks", "domain_intersection", "live"],
            result: null,
          },
        ],
      }),
    );
    await expect(
      runInWorkspace("org-cloud", () => LinkGapService.run(ctx(), input())),
    ).rejects.toThrow(/Every provider read failed/);
    expect(
      all(
        `select operation, source, kind, project_id from provider_health_events`,
      ),
    ).toEqual([
      {
        operation: "link_gap",
        source: "service",
        kind: "rejected",
        project_id: "p1",
      },
    ]);
    expect(
      String(all(`select message from provider_health_events`)[0]?.message),
    ).toContain("order_by");
  });

  it("drops the own site and compared competitors and puts shared linkers first", async () => {
    await runInWorkspace("org-cloud", () => LinkGapService.run(ctx(), input()));
    const page = await LinkGapService.list("p1", query());
    expect(page?.rows.map((row) => row.referringDomain)).toEqual([
      "swingblog.com",
      "newsdaily.com",
    ]);
    expect(page?.rows[0]).toMatchObject({ competitorCount: 2 });
    const twoPlus = await LinkGapService.list(
      "p1",
      query({ minCompetitors: 2 }),
    );
    expect(twoPlus?.total).toBe(1);
  });

  it("saves exact linking pages only after a priced evidence read, and flags sponsored links", async () => {
    await runInWorkspace("org-cloud", () => LinkGapService.run(ctx(), input()));
    const run = all(`select id from link_gap_runs`)[0];
    const evidenceInput = {
      runId: String(run?.id),
      domains: ["swingblog.com"],
    };
    const quote = await runInWorkspace("org-cloud", () =>
      LinkEvidenceService.estimate(ctx(), evidenceInput),
    );
    expect(quote).toMatchObject({ available: true, providerReads: 2 });

    await runInWorkspace("org-cloud", () =>
      LinkEvidenceService.run(ctx(), evidenceInput),
    );
    const page = await LinkGapService.list("p1", query());
    const blog = page?.rows.find(
      (row) => row.referringDomain === "swingblog.com",
    );
    expect(blog?.evidenceCount).toBeGreaterThan(0);
    expect(blog?.evidence[0]).toMatchObject({
      urlFrom: "https://swingblog.com/best-swings",
      isSponsored: true,
    });
    expect(blog?.qualification.attributes.sponsored).toBe(true);
  });

  it("does not show one project's runs, or read their domains, from another", async () => {
    await runInWorkspace("org-cloud", () => LinkGapService.run(ctx(), input()));
    const run = all(`select id from link_gap_runs`)[0];
    expect(await LinkGapService.list("p2", query())).toBeNull();
    await expect(
      runInWorkspace("org-cloud", () =>
        LinkEvidenceService.estimate(ctx("p2"), {
          runId: String(run?.id),
          domains: ["swingblog.com"],
        }),
      ),
    ).rejects.toThrow(/not found/);
  });

  it("refuses more than five competitors, a same-day repeat, and an over-limit run", async () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((n) => `${n}.com`);
    const tooMany = await runInWorkspace("org-cloud", () =>
      LinkGapService.estimate(ctx(), input({ competitors: six })),
    );
    expect(tooMany.available).toBe(false);

    await runInWorkspace("org-cloud", () => LinkGapService.run(ctx(), input()));
    await expect(
      runInWorkspace("org-cloud", () => LinkGapService.run(ctx(), input())),
    ).rejects.toThrow(/already ran today/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    state.database?.exec(
      `insert into project_spend_limits (project_id, daily_usd, updated_by_user_id) values ('p1', 0.001, 'u1')`,
    );
    await expect(
      runInWorkspace("org-cloud", () =>
        LinkGapService.run(ctx(), input(), { repeat: true }),
      ),
    ).rejects.toThrow(/spend limit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
