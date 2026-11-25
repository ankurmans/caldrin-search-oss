import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInWorkspace } from "@/server/lib/workspace-scope";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { LinkDiscoveryService } from "./LinkDiscoveryService";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
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
vi.mock("@/server/features/content/services/ContentService", () => ({
  ContentService: {},
}));

const providerFetch = vi.fn<typeof fetch>();
const ctx = {
  projectId: "p1",
  organizationId: "org-cloud",
  userId: "u1",
  userEmail: "u@e.com",
};
const inWorkspace = <T>(fn: () => Promise<T>) =>
  runInWorkspace("org-cloud", fn);
const rows = (statement: string) =>
  state.database?.prepare(statement).all() ?? [];

const backlink = (domain: string, urlTo: string) => ({
  type: "backlink",
  domain_from: domain,
  url_from: `https://${domain}/post`,
  url_to: urlTo,
  anchor: "swings",
  domain_from_rank: 400,
  backlink_spam_score: 5,
  last_seen: "2026-09-20 07:53:51 +00:00",
});
const providerRows = (items: unknown[]) =>
  Response.json({
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        path: ["v3", "backlinks", "backlinks", "live"],
        cost: 0.02,
        result: [{ total_count: items.length, items }],
      },
    ],
  });
const page = (body: string, status = 200) =>
  new Response(`<html><body>${body}</body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
// Pages are served by URL; anything not listed is a 404.
const deps = (pages: Record<string, Response>) => ({
  fetchImpl: async (url: string) =>
    pages[url]?.clone() ?? new Response("gone", { status: 404 }),
  validate: async (url: string) => url,
  robots: { allowed: async () => true },
});

const OWN_PAGE = "https://shop.example.com/swings";

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
  state.database?.exec(
    `insert into projects (id, organization_id, name, domain, location_code, language_code) values
       ('p1', 'org-cloud', 'Shop', 'shop.example.com', 2840, 'en');
     insert into workspace_settings (organization_id, mode) values ('org-cloud', 'cloud')`,
  );
  vi.stubGlobal("fetch", providerFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("recovering links", () => {
  it("saves a lost link only when the live page really dropped it", async () => {
    providerFetch.mockResolvedValue(
      providerRows([
        backlink("dropped.com", OWN_PAGE),
        backlink("stillthere.com", OWN_PAGE),
      ]),
    );
    const result = await inWorkspace(() =>
      LinkDiscoveryService.runRecovery(
        ctx,
        "lost",
        {},
        deps({
          [OWN_PAGE]: page("ok"),
          "https://dropped.com/post": page("<p>No link now</p>"),
          "https://stillthere.com/post": page(
            `<a href="${OWN_PAGE}">swings</a>`,
          ),
        }),
      ),
    );
    expect(result).toMatchObject({ read: 2, created: 1, stillLinking: 1 });
    expect(
      rows(
        `select referring_domain, method, recommendation from link_prospects`,
      ),
    ).toEqual([
      {
        referring_domain: "dropped.com",
        method: "lost_link",
        recommendation: "pursue",
      },
    ]);
    expect(rows(`select operation from provider_costs`)).toEqual([
      { operation: "link_recovery_lost" },
    ]);
  });

  it("refuses a same-day repeat unless it is confirmed, without calling the provider", async () => {
    providerFetch.mockResolvedValue(providerRows([]));
    await inWorkspace(() =>
      LinkDiscoveryService.runRecovery(ctx, "lost", {}, deps({})),
    );
    await expect(
      inWorkspace(() =>
        LinkDiscoveryService.runRecovery(ctx, "lost", {}, deps({})),
      ),
    ).rejects.toThrow(/already ran today/);
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it("saves a broken link only while the page is still broken when fetched", async () => {
    providerFetch.mockResolvedValue(
      providerRows([
        backlink("a.com", "https://shop.example.com/dead"),
        backlink("b.com", OWN_PAGE),
      ]),
    );
    const result = await inWorkspace(() =>
      LinkDiscoveryService.runRecovery(
        ctx,
        "broken",
        {},
        deps({ [OWN_PAGE]: page("fixed") }),
      ),
    );
    expect(result).toMatchObject({ created: 1, alreadyFixed: 1 });
    expect(rows(`select referring_domain, method from link_prospects`)).toEqual(
      [{ referring_domain: "a.com", method: "broken_link" }],
    );
  });
});

describe("unlinked mentions", () => {
  it("saves only pages that name the brand and do not link, with the sentence as evidence", async () => {
    const result = await inWorkspace(() =>
      LinkDiscoveryService.checkMentions(
        ctx,
        {
          urls: [
            "https://unlinked.com/review",
            "https://linked.com/review",
            "https://other.com/review",
            "https://down.com/review",
          ],
        },
        deps({
          "https://unlinked.com/review": page(
            "<p>We love Shop for swings.</p>",
          ),
          "https://linked.com/review": page(
            `<p>Shop is great: <a href="${OWN_PAGE}">link</a></p>`,
          ),
          "https://other.com/review": page("<p>Nothing relevant.</p>"),
        }),
      ),
    );
    expect(result).toMatchObject({
      checked: 4,
      created: 1,
      alreadyLinked: 1,
      notMentioned: 1,
      unreadable: 1,
    });
    const signals = rows(
      `select value from link_prospect_signals where kind = 'brand_mention'`,
    );
    expect(signals).toHaveLength(1);
    expect(String(signals[0]?.value)).toContain("We love Shop for swings");
  });
});
