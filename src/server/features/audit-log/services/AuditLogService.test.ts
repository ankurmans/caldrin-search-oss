import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { AuditLogService } from "./AuditLogService";

const state = vi.hoisted(() => ({ database: null as DatabaseSync | null }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});

const alice = {
  userId: "u1",
  userEmail: "alice@e.com",
  organizationId: "org-a",
};

beforeEach(() => {
  state.database = createMigratedDatabase();
});
afterEach(() => state.database?.close());

describe("audit log", () => {
  it("lists newest first, a page at a time, and only for the asking workspace", async () => {
    for (let i = 0; i < 52; i++) {
      await AuditLogService.recordUser(
        alice,
        "project.created",
        `Project ${i}`,
      );
    }
    await AuditLogService.recordUser(
      { ...alice, organizationId: "org-b" },
      "project.created",
      "Someone else's project",
    );

    const first = await AuditLogService.list("org-a", {});
    expect(first.rows).toHaveLength(50);
    expect(first.rows.every((row) => row.organizationId === "org-a")).toBe(
      true,
    );
    expect(first.next).not.toBeNull();

    const second = await AuditLogService.list("org-a", {
      before: first.next ?? undefined,
    });
    expect(second.rows).toHaveLength(2);
    expect(second.next).toBeNull();
  });

  it("filters by an action group and by who did it", async () => {
    await AuditLogService.recordUser(alice, "links.reply_logged", "Reply");
    await AuditLogService.recordUser(alice, "spend.limits_changed", "Limits");
    await AuditLogService.record({
      organizationId: "org-a",
      action: "agent.tool_called",
      actorKind: "agent",
      summary: "Ran save_keywords",
    });

    const links = await AuditLogService.list("org-a", { action: "links." });
    expect(links.rows.map((row) => row.action)).toEqual(["links.reply_logged"]);
    const agents = await AuditLogService.list("org-a", { actorKind: "agent" });
    expect(agents.rows.map((row) => row.summary)).toEqual([
      "Ran save_keywords",
    ]);
  });

  it("exports a CSV in which no cell can run as a spreadsheet formula", async () => {
    await AuditLogService.recordUser(
      alice,
      "member.invited",
      '=HYPERLINK("http://evil.example","x")',
    );
    const { csv, rows } = await AuditLogService.exportCsv("org-a", {});
    expect(rows).toBe(1);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
  });

  it("drops events past the retention window and keeps recent ones", async () => {
    await AuditLogService.recordUser(alice, "project.created", "Recent");
    state.database?.exec(
      `insert into audit_events (id, created_at, organization_id, actor_kind, action, summary, outcome)
       values ('old', '2020-01-01T00:00:00.000Z', 'org-a', 'user', 'project.created', 'Old', 'success')`,
    );
    await AuditLogService.prune();
    const left = await AuditLogService.list("org-a", {});
    expect(left.rows.map((row) => row.summary)).toEqual(["Recent"]);
  });
});
