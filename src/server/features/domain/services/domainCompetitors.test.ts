import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInWorkspace } from "@/server/lib/workspace-scope";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { CompetitorExplorerService } from "@/server/features/site-explorer/services/CompetitorExplorerService";
import { getCompetitors } from "./domainCompetitors";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  cache: new Map<string, unknown>(),
}));
vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: (work: Promise<unknown>) => void work,
}));
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
const customer = {
  organizationId: "org-cloud",
  userId: "u1",
  userEmail: "u@e.com",
};
const market = { projectId: "p1", locationCode: 2840, languageCode: "en" };

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
  state.cache.clear();
  state.database.exec(
    `insert into projects (id, organization_id, name, domain, location_code, language_code) values
       ('p1', 'org-cloud', 'Shop', 'shop.example.com', 2840, 'en')`,
  );
  state.database.exec(
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
              total_count: 250,
              items: [
                {
                  domain: "rival.com",
                  avg_position: 12.5,
                  intersections: 340,
                  full_domain_metrics: { organic: { count: 9000, etv: 50000 } },
                },
                { domain: "other.example.com", intersections: 1 },
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

describe("getCompetitors", () => {
  it("reads the provider once per domain, never lists the domain itself, and caches", async () => {
    const read = () =>
      runInWorkspace("org-cloud", () =>
        getCompetitors(
          { ...market, domain: "https://www.other.example.com/x" },
          customer,
        ),
      );
    const first = await read();
    expect(first).toMatchObject({
      domain: "other.example.com",
      isProjectDomain: false,
      source: "live",
      totalCount: 250,
    });
    expect(first.items.map((item) => item.domain)).toEqual(["rival.com"]);

    await read();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the project's stored competitor discovery instead of a second read", async () => {
    await runInWorkspace("org-cloud", () =>
      CompetitorExplorerService.discover({ ...customer, projectId: "p1" }),
    );
    fetchMock.mockClear();

    const result = await runInWorkspace("org-cloud", () =>
      getCompetitors({ ...market, domain: "shop.example.com" }, customer),
    );
    expect(result).toMatchObject({ isProjectDomain: true, source: "stored" });
    expect(result.items.map((item) => item.domain)).toEqual([
      "rival.com",
      "other.example.com",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
