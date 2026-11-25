import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInWorkspace } from "@/server/lib/workspace-scope";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { CompetitorExplorerService } from "./CompetitorExplorerService";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  cache: new Map<string, unknown>(),
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
  getOptionalEnvValue: async () => "operator-key",
  getRequiredEnvValue: async () => "operator-key",
  getWorkersEnv: async () => ({}),
}));
vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: async (prefix: string, params: Record<string, unknown>) =>
    `${prefix}:${JSON.stringify(params)}`,
  getCached: async (key: string) => state.cache.get(key) ?? null,
  setCached: async (key: string, value: unknown) => {
    state.cache.set(key, value);
  },
}));

const fetchMock = vi.fn<typeof fetch>();
const ctx = (projectId = "p1") => ({
  projectId,
  organizationId: "org-cloud",
  userId: "u1",
  userEmail: "u@e.com",
});
const sql = (statement: string) => state.database?.exec(statement);
const all = (statement: string) =>
  state.database?.prepare(statement).all() ?? [];

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
  state.cache.clear();
  sql(
    `insert into projects (id, organization_id, name, domain, location_code, language_code) values
       ('p1', 'org-cloud', 'Shop', 'shop.example.com', 2840, 'en'),
       ('p2', 'org-cloud', 'Other', 'other.example.com', 2840, 'en')`,
  );
  sql(
    `insert into workspace_settings (organization_id, mode) values ('org-cloud', 'cloud')`,
  );
  fetchMock.mockImplementation(async () =>
    Response.json({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          path: [
            "v3",
            "dataforseo_labs",
            "google",
            "competitors_domain",
            "live",
          ],
          cost: 0.01,
          result: [
            {
              total_count: 2,
              items: [
                {
                  domain: "rival.com",
                  avg_position: 12.5,
                  intersections: 340,
                  full_domain_metrics: { organic: { count: 9000, etv: 50000 } },
                },
                { domain: "shop.example.com", intersections: 1 },
              ],
            },
          ],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("competitor discovery", () => {
  it("costs nothing to open and is paid only when discovered", async () => {
    expect(
      await runInWorkspace("org-cloud", () =>
        CompetitorExplorerService.cachedDiscovery(ctx()),
      ),
    ).toBeNull();
    const quote = await runInWorkspace("org-cloud", () =>
      CompetitorExplorerService.estimateDiscovery(ctx()),
    );
    expect(quote.available).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const found = await runInWorkspace("org-cloud", () =>
      CompetitorExplorerService.discover(ctx()),
    );
    // The project's own domain is never offered as its own competitor.
    expect(found.items.map((item) => item.domain)).toEqual(["rival.com"]);
    expect(all(`select operation from provider_costs`)).toEqual([
      { operation: "site_explorer_competitors" },
    ]);

    const again = await runInWorkspace("org-cloud", () =>
      CompetitorExplorerService.cachedDiscovery(ctx()),
    );
    expect(again?.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("saved competitors", () => {
  it("saves a discovered competitor once, with its markets, only for its own project", async () => {
    await CompetitorExplorerService.add(ctx(), {
      domains: ["https://www.Rival.com/pricing"],
      discovered: true,
    });
    const [saved] = await CompetitorExplorerService.list("p1");
    expect(saved).toMatchObject({ domain: "rival.com", source: "discovered" });
    expect(await CompetitorExplorerService.list("p2")).toEqual([]);

    await CompetitorExplorerService.setMarkets(ctx(), {
      domain: "rival.com",
      markets: [{ locationCode: 2826, languageCode: "en" }],
    });
    expect((await CompetitorExplorerService.list("p1"))[0]?.markets).toEqual([
      { locationCode: 2826, languageCode: "en" },
    ]);
    await expect(
      CompetitorExplorerService.setMarkets(ctx("p2"), {
        domain: "rival.com",
        markets: [],
      }),
    ).rejects.toThrow(/not saved/);

    await CompetitorExplorerService.remove(ctx(), "rival.com");
    expect(await CompetitorExplorerService.list("p1")).toEqual([]);
  });

  it("keeps a hand-added competitor manual when it is later seen in discovery", async () => {
    await CompetitorExplorerService.add(ctx(), { domains: ["rival.com"] });
    await CompetitorExplorerService.add(ctx(), {
      domains: ["rival.com"],
      discovered: true,
    });
    expect((await CompetitorExplorerService.list("p1"))[0]?.source).toBe(
      "manual",
    );
  });
});

describe("dismissed competitors", () => {
  const inWorkspace = <T>(run: () => Promise<T>) =>
    runInWorkspace("org-cloud", run);

  it("hides a dismissed domain without a second paid read, until it is restored or saved on purpose", async () => {
    await inWorkspace(() => CompetitorExplorerService.discover(ctx()));
    await CompetitorExplorerService.add(ctx(), { domains: ["rival.com"] });

    await CompetitorExplorerService.dismiss(ctx(), {
      domains: ["rival.com"],
      kind: "directory",
    });
    // A saved competitor stops being one when it is ruled out.
    expect(await CompetitorExplorerService.list("p1")).toEqual([]);
    const hidden = await inWorkspace(() =>
      CompetitorExplorerService.cachedDiscovery(ctx()),
    );
    expect(hidden?.items).toEqual([]);
    expect(hidden?.dismissed).toMatchObject([
      {
        domain: "rival.com",
        kind: "directory",
        stats: { sharedKeywords: 340 },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await CompetitorExplorerService.restore(ctx(), "rival.com");
    const back = await inWorkspace(() =>
      CompetitorExplorerService.cachedDiscovery(ctx()),
    );
    expect(back?.items).toHaveLength(1);

    await CompetitorExplorerService.dismiss(ctx(), {
      domains: ["rival.com"],
      kind: "publisher",
    });
    await CompetitorExplorerService.add(ctx(), { domains: ["rival.com"] });
    const saved = await inWorkspace(() =>
      CompetitorExplorerService.cachedDiscovery(ctx()),
    );
    expect(saved?.dismissed).toEqual([]);
  });

  it("rules out many domains at once, dropping the saved ones from competitors", async () => {
    await CompetitorExplorerService.add(ctx(), { domains: ["rival.com"] });
    const count = await CompetitorExplorerService.dismiss(ctx(), {
      domains: ["rival.com", "https://www.clutch.co/x", "clutch.co"],
      kind: "directory",
    });
    expect(count).toBe(2);
    expect(await CompetitorExplorerService.list("p1")).toEqual([]);
    expect(
      all(`select domain from competitor_dismissals order by domain`),
    ).toEqual([{ domain: "clutch.co" }, { domain: "rival.com" }]);
  });

  it("suggests a kind from another project of the same organization only", async () => {
    sql(
      `insert into workspace_settings (organization_id, mode) values ('org-other', 'cloud');
       insert into projects (id, organization_id, name, domain, location_code, language_code)
         values ('p3', 'org-other', 'Else', 'else.example.com', 2840, 'en')`,
    );
    await CompetitorExplorerService.dismiss(ctx("p3"), {
      domains: ["rival.com"],
      kind: "marketplace",
    });
    await inWorkspace(() => CompetitorExplorerService.discover(ctx()));
    const unrelated = await inWorkspace(() =>
      CompetitorExplorerService.cachedDiscovery(ctx()),
    );
    expect(unrelated?.suggestedKinds).toEqual({});

    await CompetitorExplorerService.dismiss(ctx("p2"), {
      domains: ["rival.com"],
      kind: "directory",
    });
    const sameOrg = await inWorkspace(() =>
      CompetitorExplorerService.cachedDiscovery(ctx()),
    );
    expect(sameOrg?.suggestedKinds).toEqual({ "rival.com": "directory" });
    expect(sameOrg?.items).toHaveLength(1);
  });
});
