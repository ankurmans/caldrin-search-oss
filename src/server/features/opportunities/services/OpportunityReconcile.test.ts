import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { engineInputs, NOW } from "../opportunityTestFixtures";
import { OpportunityEngineService } from "./OpportunityEngineService";

const state = vi.hoisted(() => ({ database: null as DatabaseSync | null }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("./loadEngineInputs", () => ({ loadEngineInputs: vi.fn() }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
});

const scope = { projectId: "p1", organizationId: "org-1", userId: "u1" };
const LATER = new Date(NOW.getTime() + 86_400_000);

function ids(sql: string) {
  return (state.database?.prepare(sql).all() ?? []).map((r) => String(r.id));
}
function count(sql: string) {
  const row = state.database?.prepare(sql).get();
  return Number(Object.values(row ?? { n: -1 })[0]);
}
function exec(sql: string) {
  state.database?.exec(sql);
}

const runAt = (now: Date, inputs = engineInputs()) =>
  OpportunityEngineService.run(scope, { inputs, now });

// A later run whose Search Console read returned no queries at all.
const withoutQueries = () => {
  const inputs = engineInputs();
  if (inputs.gsc) inputs.gsc.rows = [];
  return inputs;
};

describe("reconciling a re-run", () => {
  it("removes rows with no history, keeps and flags rows with a draft, change, dismissal or briefing", async () => {
    await runAt(NOW);
    const queryRows = ids(
      `select id from content_opportunities where dedupe_key like '%|%' order by id`,
    );
    expect(queryRows.length).toBeGreaterThanOrEqual(5);
    const [drafted = "", logged = "", dismissed = "", briefed = ""] = queryRows;
    exec(`insert into content_assets (id, project_id, organization_id, opportunity_id, title, search_intent, brief_markdown, body_html, meta_title, meta_description, generator, status, created_by_user_id)
      values ('a1', 'p1', 'org-1', '${drafted}', 't', 'i', 'b', 'h', 'm', 'd', 'template', 'draft', 'u1')`);
    exec(`insert into change_ledger_entries (id, project_id, organization_id, opportunity_id, kind, provider, proposed_action, requested_by_user_id)
      values ('l1', 'p1', 'org-1', '${logged}', 'metadata_update', 'manual', 'x', 'u1')`);
    await OpportunityEngineService.setStatus("p1", dismissed, "dismissed");
    await OpportunityEngineService.setStatus("p1", briefed, "briefed");
    const evidenceBefore = count(`select count(*) from opportunity_evidence`);

    const summary = await runAt(LATER, withoutQueries());

    expect(summary.reconciled.keptStale).toBe(4);
    expect(summary.reconciled.removed).toBeGreaterThan(0);
    const remainingQueryRows = ids(
      `select id from content_opportunities where dedupe_key like '%|%'`,
    );
    expect(remainingQueryRows).toHaveLength(4);
    expect(remainingQueryRows).toEqual(
      expect.arrayContaining([drafted, logged, dismissed, briefed]),
    );
    // No evidence is left behind for a removed row.
    expect(
      count(
        `select count(*) from opportunity_evidence e where not exists (select 1 from content_opportunities o where o.id = e.opportunity_id)`,
      ),
    ).toBe(0);
    expect(evidenceBefore).toBeGreaterThan(0);

    const list = await OpportunityEngineService.list("p1");
    const flagged = list.filter((r) => r.noLongerFound).map((r) => r.id);
    expect(flagged).toHaveLength(4);
    expect(flagged).toEqual(
      expect.arrayContaining([drafted, logged, dismissed, briefed]),
    );
    // Rows the run did re-produce are not flagged.
    expect(list.some((r) => !r.noLongerFound)).toBe(true);

    // When the analysis finds them again the flag goes away.
    await runAt(new Date(LATER.getTime() + 86_400_000));
    const again = await OpportunityEngineService.list("p1");
    expect(again.some((r) => r.noLongerFound)).toBe(false);
  });

  it("never removes or flags rows from a rule that did not run", async () => {
    await runAt(NOW);
    const before = ids(`select id from content_opportunities`).length;
    const downInputs = engineInputs({
      gsc: null,
      pageWindows: null,
      unavailable: [
        { source: "gsc", reason: "Search Console could not be read." },
      ],
    });

    const summary = await runAt(LATER, downInputs);

    expect(summary.reconciled.removed).toBe(0);
    expect(summary.reconciled.keptStale).toBe(0);
    expect(ids(`select id from content_opportunities`).length).toBe(before);
    const list = await OpportunityEngineService.list("p1");
    const queryRows = list.filter((r) => r.dedupeKey.includes("|"));
    expect(queryRows.length).toBeGreaterThan(0);
    expect(queryRows.every((r) => !r.noLongerFound)).toBe(true);
  });
});
