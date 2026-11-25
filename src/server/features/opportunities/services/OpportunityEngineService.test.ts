import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { engineInputs, NOW } from "../opportunityTestFixtures";
import { OpportunityRepository } from "../repositories/OpportunityRepository";
import { OpportunityRefusal, type PaidKeywordGapRequest } from "../types";
import { OpportunityEngineService } from "./OpportunityEngineService";

const state = vi.hoisted(() => ({ database: null as DatabaseSync | null }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
// Reads of the project's live data are not under test: inputs are injected.
vi.mock("./loadEngineInputs", () => ({ loadEngineInputs: vi.fn() }));
vi.mock("@/db", () => ({
  db: drizzle(async (query, params, method) => {
    if (!state.database) throw new Error("Database not initialized");
    const statement = state.database.prepare(query);
    const values = params.map((value: unknown): SQLInputValue => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint"
      )
        return value;
      throw new Error("Unexpected SQL parameter");
    });
    if (method === "run") {
      statement.run(...values);
      return { rows: [] };
    }
    return { rows: statement.all(...values).map((row) => Object.values(row)) };
  }),
}));

beforeEach(() => {
  state.database?.close();
  state.database = new DatabaseSync(":memory:");
  state.database.exec("PRAGMA foreign_keys = OFF");
  const files = readdirSync("drizzle/sqlite").filter((f) => f.endsWith(".sql"));
  files.sort();
  for (const file of files) {
    state.database.exec(
      readFileSync(`drizzle/sqlite/${file}`, "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  // Some migrations switch enforcement back on; ownership is by projectId.
  state.database.exec("PRAGMA foreign_keys = OFF");
});

function scope(projectId: string) {
  return { projectId, organizationId: "org-1", userId: "user-1" };
}

function count(sql: string): number {
  const row = state.database?.prepare(sql).get();
  return Number(Object.values(row ?? { n: -1 })[0]);
}

const run = (projectId: string, extra = {}) =>
  OpportunityEngineService.run(scope(projectId), {
    inputs: engineInputs(),
    now: NOW,
    ...extra,
  });

describe("OpportunityEngineService", () => {
  it("stores every opportunity with evidence rows behind it", async () => {
    const summary = await run("p1");
    expect(summary.stored).toBeGreaterThan(8);
    expect(
      count(
        `select count(*) from content_opportunities where project_id = 'p1'`,
      ),
    ).toBe(summary.stored);
    expect(
      count(`select count(*) from content_opportunities o
        where not exists (select 1 from opportunity_evidence e where e.opportunity_id = o.id)`),
    ).toBe(0);
    const rows = await OpportunityEngineService.list("p1");
    for (const row of rows) {
      expect(row.priority).not.toBeNull();
      expect(row.priorityReason).toMatch(/\d/);
      expect(row.observedAt).toBe(NOW.toISOString());
      expect(row.evidenceCount).toBeGreaterThan(0);
    }
    const detail = await OpportunityEngineService.getDetail("p1", rows[0].id);
    expect(detail.evidence.every((e) => e.source && e.label && e.value)).toBe(
      true,
    );
  });

  it("updates on re-run instead of duplicating, and keeps a dismissed status", async () => {
    await run("p1");
    const before = await OpportunityEngineService.list("p1");
    const evidenceBefore = count(`select count(*) from opportunity_evidence`);
    const target = before.find(
      (r) => r.recommendedAction === "refresh_existing_page",
    )!;
    await OpportunityEngineService.setStatus("p1", target.id, "dismissed");

    await run("p1");
    const after = await OpportunityEngineService.list("p1");
    const afterIds = after.map((r) => r.id);
    const beforeIds = before.map((r) => r.id);
    afterIds.sort();
    beforeIds.sort();
    expect(afterIds).toEqual(beforeIds);
    expect(count(`select count(*) from opportunity_evidence`)).toBe(
      evidenceBefore,
    );
    expect(after.find((r) => r.id === target.id)?.status).toBe("dismissed");
  });

  it("keeps projects separate for runs, lists, detail and status", async () => {
    await run("p1");
    await run("p2");
    const p1 = await OpportunityEngineService.list("p1");
    const p2 = await OpportunityEngineService.list("p2");
    expect(p1.length).toBe(p2.length);
    expect(p1.some((a) => p2.some((b) => b.id === a.id))).toBe(false);

    const foreign = p2[0].id;
    await expect(
      OpportunityEngineService.getDetail("p1", foreign),
    ).rejects.toThrow("Opportunity not found");
    await expect(
      OpportunityEngineService.setStatus("p1", foreign, "dismissed"),
    ).rejects.toThrow();
    expect((await OpportunityEngineService.list("p2"))[0]?.status).toBe("open");
  });

  it("emits no_action with its reason and filters by action, intent, status and source", async () => {
    await run("p1");
    const none = await OpportunityEngineService.list("p1", {
      action: "no_action",
    });
    expect(none.length).toBeGreaterThan(0);
    expect(none.every((r) => r.reason.length > 0)).toBe(true);

    const audit = await OpportunityEngineService.list("p1", {
      source: "site_audit",
    });
    expect(audit.map((r) => r.dedupeKey)).toEqual(
      expect.arrayContaining(["technical::missing-title"]),
    );
    expect(audit.every((r) => r.dataSource === "site_audit")).toBe(true);

    const commercial = await OpportunityEngineService.list("p1", {
      intent: "commercial",
    });
    expect(commercial.every((r) => r.intent === "commercial")).toBe(true);
    expect(
      await OpportunityEngineService.list("p1", { status: "dismissed" }),
    ).toEqual([]);
  });

  it("labels simulated data as simulated and never creates a declining-page row from it", async () => {
    const base = engineInputs();
    await run("p1", {
      inputs: {
        ...base,
        gsc: { ...base.gsc!, source: "simulated" },
        pageWindows: null,
        storeMode: "simulated",
      },
    });
    const gscRows = await OpportunityEngineService.list("p1", {
      source: "gsc",
    });
    expect(gscRows).toEqual([]);
    const simulated = await OpportunityEngineService.list("p1", {
      source: "simulated",
    });
    expect(simulated.length).toBeGreaterThan(0);
    expect(simulated.some((r) => r.dedupeKey.startsWith("declining::"))).toBe(
      false,
    );
  });
});

describe("paid keyword-gap rule", () => {
  const fetchCompetitorKeywords = vi.fn();
  const assertWithinLimits = vi.fn();
  const recordCost = vi.fn();
  const paid: PaidKeywordGapRequest = {
    competitorDomains: ["rival.com"],
    estimatedUsd: 0.4,
    source: { fetchCompetitorKeywords },
  };

  beforeEach(() => {
    assertWithinLimits.mockResolvedValue(undefined);
    recordCost.mockResolvedValue(undefined);
    fetchCompetitorKeywords.mockResolvedValue({
      observedAt: NOW.toISOString(),
      costUsd: 0.31,
      keywords: [
        {
          keyword: "cold brew concentrate",
          competitorDomain: "rival.com",
          competitorPosition: 3,
          competitorUrl: "https://rival.com/cold-brew",
          searchVolume: 2400,
          keywordDifficulty: null,
        },
      ],
    });
  });

  it("is refused without allowPaid and makes no call and stores nothing", async () => {
    await expect(
      run("p1", { paid, spendGate: { assertWithinLimits }, recordCost }),
    ).rejects.toBeInstanceOf(OpportunityRefusal);
    expect(fetchCompetitorKeywords).not.toHaveBeenCalled();
    expect(assertWithinLimits).not.toHaveBeenCalled();
    expect(count(`select count(*) from content_opportunities`)).toBe(0);
  });

  it("checks limits first, records the provider's cost and stores competitor gaps", async () => {
    const summary = await run("p1", {
      allowPaid: true,
      paid,
      spendGate: { assertWithinLimits },
      recordCost,
    });
    expect(assertWithinLimits).toHaveBeenCalledWith(scope("p1"), {
      estimatedUsd: 0.4,
      provider: "dataforseo",
      operation: "opportunity_keyword_gap",
    });
    expect(recordCost).toHaveBeenCalledWith(
      scope("p1"),
      expect.objectContaining({ estimatedUsd: 0.4, costUsd: 0.31 }),
    );
    expect(summary.paid).toEqual({
      ran: true,
      estimatedUsd: 0.4,
      costUsd: 0.31,
    });
    const gaps = await OpportunityEngineService.list("p1", {
      source: "competitor",
    });
    expect(gaps.map((g) => g.query)).toEqual(["cold brew concentrate"]);
  });

  it("does not call the provider when the spend gate refuses", async () => {
    assertWithinLimits.mockRejectedValue(new Error("Daily limit $1 reached"));
    await expect(
      run("p1", {
        allowPaid: true,
        paid,
        spendGate: { assertWithinLimits },
        recordCost,
      }),
    ).rejects.toThrow("Daily limit");
    expect(fetchCompetitorKeywords).not.toHaveBeenCalled();
    expect(recordCost).not.toHaveBeenCalled();
  });
});

describe("latestAuditIssues", () => {
  it("reads only the project's newest completed audit", async () => {
    const db = state.database!;
    const audit = (
      id: string,
      project: string,
      status: string,
      started: string,
    ) =>
      db.exec(`insert into audits (id, project_id, started_by_user_id, start_url, status, started_at, completed_at)
        values ('${id}', '${project}', 'u', 'https://x.test', '${status}', '${started}', '${started}')`);
    const issue = (id: string, auditId: string, type: string) =>
      db.exec(`insert into audit_issues (id, audit_id, page_url, issue_type, severity)
        values ('${id}', '${auditId}', 'https://x.test/${id}', '${type}', 'warning')`);
    audit("old", "p1", "completed", "2026-10-01 00:00:00");
    audit("new", "p1", "completed", "2026-11-01 00:00:00");
    audit("running", "p1", "running", "2026-11-10 00:00:00");
    audit("other", "p2", "completed", "2026-11-05 00:00:00");
    issue("i-old", "old", "thin-content");
    issue("i-new", "new", "missing-title");
    issue("i-run", "running", "duplicate-title");
    issue("i-other", "other", "broken-page");

    const result = await OpportunityRepository.latestAuditIssues("p1");
    expect(result?.auditId).toBe("new");
    expect(result?.issues.map((i) => i.issueType)).toEqual(["missing-title"]);
    expect(await OpportunityRepository.latestAuditIssues("p3")).toBeNull();
  });
});
