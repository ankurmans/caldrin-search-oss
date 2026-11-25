import { beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerRefusal } from "../types";
import { LedgerService } from "./LedgerService";
import {
  approved,
  execSql,
  executed,
  propose,
  proposal,
  resetDatabase,
  scopeA,
  scopeB,
  seedAsset,
  seedOpportunity,
  setAssetRevision,
  setEntryColumn,
} from "./ledgerTestSupport";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => (await import("./ledgerDb")).ledgerDbMock());

const NOW = new Date("2026-11-16T10:00:00Z");

beforeEach(resetDatabase);

function rejection(promise: Promise<unknown>) {
  return expect(promise).rejects.toBeInstanceOf(LedgerRefusal);
}

describe("tenant isolation", () => {
  it("never reads or changes another project's entry", async () => {
    const entry = await approved();
    await rejection(LedgerService.getEntry("project-b", entry.id));
    expect(await LedgerService.listEntries("project-b")).toEqual([]);
    await rejection(LedgerService.approveChange(scopeB, entry.id));
    await rejection(LedgerService.rejectChange(scopeB, entry.id, "no"));
    await rejection(LedgerService.beginExecution(scopeB, entry.id));
    await rejection(LedgerService.recordFailure(scopeB, entry.id, "x"));
    await rejection(
      LedgerService.recordExecution(scopeB, entry.id, {
        publicationStatus: "draft",
      }),
    );
    await rejection(LedgerService.beginRollback(scopeB, entry.id));
    await rejection(LedgerService.recordRollback(scopeB, entry.id));
    await rejection(
      LedgerService.recordFinalDecision(scopeB, entry.id, "keep"),
    );
    await rejection(
      LedgerService.recordObservation(scopeB, entry.id, {
        phase: "baseline",
        source: "manual",
        metric: "m",
        value: 1,
      }),
    );
    await rejection(
      LedgerService.collectGscObservations(scopeB, entry.id, NOW),
    );
    const stillA = await LedgerService.getEntry("project-a", entry.id);
    expect(stillA.entry.status).toBe("approved");
    expect(stillA.observations).toEqual([]);
  });

  it("refuses an opportunity or content asset from another project", async () => {
    seedOpportunity("project-b", "opp-b");
    seedAsset("project-b", "asset-b");
    await rejection(
      LedgerService.proposeChange(scopeA, proposal({ opportunityId: "opp-b" })),
    );
    await rejection(
      LedgerService.proposeChange(
        scopeA,
        proposal({ contentAssetId: "asset-b" }),
      ),
    );
    expect(await LedgerService.listEntries("project-a")).toEqual([]);
  });
});

describe("proposing", () => {
  it("copies the opportunity's evidence and is idempotent per revision", async () => {
    seedOpportunity("project-a", "opp-a");
    const first = await propose({ opportunityId: "opp-a" });
    const again = await LedgerService.proposeChange(
      scopeA,
      proposal({ opportunityId: "opp-a" }),
    );
    expect(again.id).toBe(first.id);
    expect(await LedgerService.listEntries("project-a")).toHaveLength(1);
    const detail = await LedgerService.getEntry("project-a", first.id);
    expect(detail.evidence).toEqual([
      expect.objectContaining({
        source: "gsc",
        label: "Impressions",
        value: "100",
      }),
    ]);
    // Editing the opportunity later does not rewrite why the change was made.
    execSql("UPDATE opportunity_evidence SET value = '999'");
    const after = await LedgerService.getEntry("project-a", first.id);
    expect(after.evidence[0]?.value).toBe("100");
  });

  it("proposes a new entry once the content has a new revision", async () => {
    const first = await propose();
    setAssetRevision("asset-1", 2);
    const second = await LedgerService.proposeChange(scopeA, proposal());
    expect(second.id).not.toBe(first.id);
    expect(second.contentRevision).toBe(2);
  });

  it("keeps two asset-less fixes on different pages apart", async () => {
    const base = proposal({
      kind: "technical_fix",
      provider: "manual",
      contentAssetId: null,
    });
    const a = await LedgerService.proposeChange(scopeA, {
      ...base,
      targetUrl: "https://x.example/a",
    });
    const b = await LedgerService.proposeChange(scopeA, {
      ...base,
      targetUrl: "https://x.example/b",
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe("approval gate", () => {
  it.each(["proposed", "rejected", "failed"] as const)(
    "never executes a %s change",
    async (status) => {
      const entry = await propose();
      setEntryColumn(entry.id, "status", status);
      await rejection(LedgerService.beginExecution(scopeA, entry.id));
    },
  );

  it("never executes an approved status that has no approver on record", async () => {
    const entry = await propose();
    setEntryColumn(entry.id, "status", "approved");
    await rejection(LedgerService.beginExecution(scopeA, entry.id));
  });

  it("refuses to approve once the content moved past the proposed revision", async () => {
    const entry = await propose();
    setAssetRevision("asset-1", 2);
    await rejection(LedgerService.approveChange(scopeA, entry.id));
  });

  it("refuses to execute when the content moved after approval", async () => {
    const entry = await approved();
    setAssetRevision("asset-1", 2);
    await expect(
      LedgerService.beginExecution(scopeA, entry.id),
    ).rejects.toThrow(/changed after it was approved/);
    const { entry: after } = await LedgerService.getEntry(
      "project-a",
      entry.id,
    );
    expect(after.status).toBe("approved");
  });

  it("refuses to execute when the entry's own revision differs from the approved one", async () => {
    const entry = await approved();
    setEntryColumn(entry.id, "content_revision", 5);
    await rejection(LedgerService.beginExecution(scopeA, entry.id));
  });

  it("lets only one of two concurrent executions begin", async () => {
    const entry = await approved();
    const results = await Promise.allSettled([
      LedgerService.beginExecution(scopeA, entry.id),
      LedgerService.beginExecution(scopeA, entry.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected");
    expect(lost?.reason).toBeInstanceOf(LedgerRefusal);
  });

  it("works for a change with no content asset", async () => {
    const entry = await LedgerService.proposeChange(
      scopeA,
      proposal({
        kind: "technical_fix",
        provider: "manual",
        contentAssetId: null,
      }),
    );
    await LedgerService.approveChange(scopeA, entry.id);
    const begun = await LedgerService.beginExecution(scopeA, entry.id);
    expect(begun.status).toBe("executing");
  });

  it("sends a failed change back through approval before a retry", async () => {
    const entry = await approved();
    await LedgerService.beginExecution(scopeA, entry.id);
    const failed = await LedgerService.recordFailure(
      scopeA,
      entry.id,
      "Shopify said no",
    );
    expect(failed).toMatchObject({
      status: "failed",
      error: "Shopify said no",
    });
    await rejection(LedgerService.beginExecution(scopeA, entry.id));

    await LedgerService.approveChange(scopeA, entry.id);
    await LedgerService.beginExecution(scopeA, entry.id);
    const done = await LedgerService.recordExecution(scopeA, entry.id, {
      publicationStatus: "draft",
    });
    expect(done).toMatchObject({ status: "executed", error: null });
  });
});

describe("rollback", () => {
  it("is refused before execution and when no rollback was recorded", async () => {
    const entry = await approved();
    await rejection(LedgerService.beginRollback(scopeA, entry.id));
    await LedgerService.beginExecution(scopeA, entry.id);
    await LedgerService.recordExecution(scopeA, entry.id, {
      publicationStatus: "draft",
    });
    await rejection(LedgerService.beginRollback(scopeA, entry.id));
    await rejection(LedgerService.recordRollback(scopeA, entry.id));
  });

  it("hands back the recorded payload once and marks the change rolled back", async () => {
    const entry = await executed();
    expect(await LedgerService.beginRollback(scopeA, entry.id)).toEqual({
      kind: "unpublish",
      payload: "article-9",
    });
    const rolled = await LedgerService.recordRollback(scopeA, entry.id);
    expect(rolled.status).toBe("rolled_back");
    await rejection(LedgerService.recordRollback(scopeA, entry.id));
  });
});
