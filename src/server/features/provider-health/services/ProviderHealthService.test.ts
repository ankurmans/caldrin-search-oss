import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { ProviderHealthService } from "./ProviderHealthService";

const state = vi.hoisted(() => ({ database: null as DatabaseSync | null }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => "operator-key",
  getRequiredEnvValue: async () => "operator-key",
  getWorkersEnv: async () => ({}),
}));

const providerFetch = vi.fn<typeof fetch>();
const rows = (statement: string) =>
  state.database?.prepare(statement).all() ?? [];

const task = (items: unknown[], statusCode = 20000, message = "Ok.") =>
  Response.json({
    status_code: 20000,
    tasks: [
      {
        status_code: statusCode,
        status_message: message,
        path: ["v3", "backlinks", "x", "live"],
        cost: 0.02,
        result: statusCode === 20000 ? [{ total_count: 1, items }] : null,
      },
    ],
  });
const linkRow = {
  domain_from: "a.com",
  url_from: "https://a.com/p",
  url_to: "https://wikipedia.org/x",
};
const sharedRow = { domain_intersection: { "1": { target: "a.com" } } };

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
  vi.stubGlobal("fetch", providerFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("provider canary", () => {
  it("records each check, names the one the provider now refuses, and runs about weekly", async () => {
    providerFetch.mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("domain_intersection")) {
        return task([], 40501, "Invalid Field: 'order_by'. Too many rules.");
      }
      return task([linkRow]);
    });

    const first = await ProviderHealthService.runScheduled();
    expect(first).toEqual({ canaryRan: true, failed: 1 });
    expect(
      rows(
        `select operation, ok, kind from provider_health_events order by operation`,
      ),
    ).toEqual([
      { operation: "canary_backlinks_broken", ok: 1, kind: null },
      { operation: "canary_backlinks_lost", ok: 1, kind: null },
      {
        operation: "canary_domain_intersection",
        ok: 0,
        kind: "rejected",
      },
    ]);
    expect(
      String(
        rows(`select message from provider_health_events where ok = 0`)[0]
          ?.message,
      ),
    ).toContain("order_by");

    const calls = providerFetch.mock.calls.length;
    expect(await ProviderHealthService.runScheduled()).toEqual({
      canaryRan: false,
      failed: 0,
    });
    expect(providerFetch.mock.calls.length).toBe(calls);
  });

  it("flags a read that comes back without the fields the product reads", async () => {
    providerFetch.mockImplementation(async (input) =>
      String(input instanceof Request ? input.url : input).includes(
        "domain_intersection",
      )
        ? task([sharedRow])
        : task([{ domain_from: "a.com" }]),
    );
    expect(await ProviderHealthService.runScheduled()).toMatchObject({
      failed: 2,
    });
    expect(
      rows(
        `select kind from provider_health_events where ok = 0 and operation like 'canary_backlinks%'`,
      ),
    ).toEqual([{ kind: "invalid_response" }, { kind: "invalid_response" }]);
  });
});

describe("service failures", () => {
  it("keeps the provider's reason and the project, and never throws", async () => {
    await ProviderHealthService.recordFailure("link_gap", new Error("boom"), {
      organizationId: "org-1",
      projectId: "p1",
    });
    expect(
      rows(
        `select operation, source, ok, kind, project_id, message from provider_health_events`,
      ),
    ).toEqual([
      {
        operation: "link_gap",
        source: "service",
        ok: 0,
        kind: "unknown",
        project_id: "p1",
        message: "boom",
      },
    ]);
  });
});
