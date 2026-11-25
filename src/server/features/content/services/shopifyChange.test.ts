import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { LedgerRefusal } from "@/server/features/ledger/types";
import { ContentRepository } from "../repositories/ContentRepository";
import { SIMULATED_SEED_ARTICLE_ID } from "../shopify/simulatedShop";
import { resetDatabase } from "./contentTestDb";
import {
  approveShopifyChange,
  getProposedChange,
  proposeShopifyChange,
} from "./shopifyChangePlan";
import {
  SEED_ONLY,
  approvedCreate,
  articleCount,
  connect,
  connectLive,
  makeAsset,
  scope,
  shop,
} from "./shopifyChangeTestSupport";
import { executeShopifyChange } from "./shopifyExecution";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => (await import("./contentTestDb")).contentDbMock());
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: vi.fn() },
}));
// Real sealing needs the worker secret; the tests only need a reversible box.
vi.mock("@/server/lib/secret-box", () => ({
  sealSecret: (plain: string) => Promise.resolve(`sealed(${plain})`),
  openSecret: (sealed: string) =>
    Promise.resolve(/^sealed\((.*)\)$/.exec(sealed)?.[1] ?? null),
}));

beforeEach(async () => {
  resetDatabase();
  await connect();
});

describe("the preview shows what will change before anything is written", () => {
  it("a new article has no before and lists the products it links", async () => {
    const asset = await makeAsset();
    const preview = await getProposedChange(scope, asset.id);
    expect(preview.before).toBeNull();
    expect(preview.draftDestination?.blogTitle).toBe("News");
    expect(preview.after.isPublished).toBe(false);
    expect(preview.diff.text).toContain("+ Title: Best light roast coffee");
    expect(preview.linkedProducts.map((p) => p.handle)).toEqual([
      "ethiopia-light-roast",
    ]);
    expect(await articleCount()).toBe(SEED_ONLY);
  });

  it("requires the previewed destination before proposal, approval and execution", async () => {
    const asset = await makeAsset();
    const original = await getProposedChange(scope, asset.id);
    const approved = await approvedCreate(asset.id);
    const pendingAsset = await makeAsset();
    const pending = await proposeShopifyChange(scope, pendingAsset.id);

    await connect();

    await expect(
      proposeShopifyChange(scope, pendingAsset.id, {
        expectedDestination: original.draftDestination?.stamp,
      }),
    ).rejects.toThrow("Reload the preview");
    await expect(approveShopifyChange(scope, pending.entry.id)).rejects.toThrow(
      "The Shopify destination changed",
    );
    await expect(executeShopifyChange(scope, approved.id)).rejects.toThrow(
      "The Shopify destination changed",
    );
    expect(await articleCount()).toBe(SEED_ONLY);
    expect(await ContentRepository.listPublications(asset.id)).toHaveLength(0);
  });

  it("an update shows the live article and a readable difference", async () => {
    const asset = await makeAsset();
    const preview = await getProposedChange(scope, asset.id, {
      targetExternalId: SIMULATED_SEED_ARTICLE_ID,
    });
    expect(preview.action).toBe("update_existing");
    expect(preview.before?.title).toBe("Pour Over Brew Guide");
    expect(preview.diff.text).toContain("- Title: Pour Over Brew Guide");
    expect(preview.diff.text).toContain("+ Title: Best light roast coffee");
    expect(preview.goesPublic).toBe(true);
    expect(preview.requiresConfirmUpdate).toBe(true);
  });
});

describe("proposing", () => {
  it("is one change per proposal, however often it is sent", async () => {
    const asset = await makeAsset();
    const a = await proposeShopifyChange(scope, asset.id);
    const b = await proposeShopifyChange(scope, asset.id);
    expect(b.entry.id).toBe(a.entry.id);
    expect(await LedgerService.listEntries(scope.projectId)).toHaveLength(1);
  });

  it("copies the opportunity's search numbers, labeled with their source", async () => {
    await ContentRepository.upsertOpportunities({
      projectId: scope.projectId,
      organizationId: scope.organizationId,
      decisions: [
        {
          query: "light roast",
          pageUrl: "https://x.example/p",
          impressions: 900,
          clicks: 4,
          ctr: 0.004,
          position: 9.5,
          action: "improve_title_and_meta",
          reason: "r",
          matchedCollectionHandle: null,
        },
      ],
      dataSource: "simulated",
      windowStart: "2026-10-01",
      windowEnd: "2026-10-28",
    });
    const [opportunity] = await ContentRepository.listOpportunities(
      scope.projectId,
    );
    const asset = await makeAsset({ opportunityId: opportunity?.id ?? null });
    const { entry } = await proposeShopifyChange(scope, asset.id);
    const detail = await LedgerService.getEntry(scope.projectId, entry.id);
    expect(entry.opportunityId).toBe(opportunity?.id);
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0]?.source).toBe("simulated");
    expect(detail.evidence[0]?.value).toContain("900 impressions");
  });

  it("refuses a read-only connection and blocking quality checks", async () => {
    const asset = await makeAsset();
    await connectLive(["read_content"]);
    await expect(proposeShopifyChange(scope, asset.id)).rejects.toThrow(
      "read-only",
    );
    await ContentRepository.deleteConnection(scope.projectId);
    await connect();
    await ContentRepository.replaceQualityChecks(asset.id, asset.revision, [
      { key: "no_placeholders", severity: "block", passed: false, detail: "x" },
    ]);
    await expect(proposeShopifyChange(scope, asset.id)).rejects.toThrow(
      "Blocking quality checks",
    );
  });
});

describe("nothing is written without an approval for this revision", () => {
  it("refuses to execute a change nobody approved, even for an approved draft", async () => {
    const asset = await makeAsset();
    const { entry } = await proposeShopifyChange(scope, asset.id);
    // The draft itself is approved; the ledger change is not.
    await ContentRepository.approveAsset(
      scope.projectId,
      asset.id,
      asset.revision,
      scope.userId,
    );
    await expect(executeShopifyChange(scope, entry.id)).rejects.toBeInstanceOf(
      LedgerRefusal,
    );
    expect(await articleCount()).toBe(SEED_ONLY);
    const after = await LedgerService.getEntry(scope.projectId, entry.id);
    expect(after.entry.status).toBe("proposed");
  });

  it("refuses an approval that belongs to an older revision of the draft", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    await ContentRepository.updateAssetContent(
      scope.projectId,
      asset.id,
      "author-1",
      {
        title: "Edited after approval",
        bodyHtml: "<p>New</p>",
        metaTitle: "m",
        metaDescription: "d",
      },
    );
    await expect(executeShopifyChange(scope, approved.id)).rejects.toThrow(
      /changed after|content changed/,
    );
    expect(await articleCount()).toBe(SEED_ONLY);
  });

  it("runs only one of two simultaneous executions", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    const results = await Promise.allSettled([
      executeShopifyChange(scope, approved.id),
      executeShopifyChange(scope, approved.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected");
    expect(lost?.status === "rejected" && lost.reason).toBeInstanceOf(
      LedgerRefusal,
    );
    expect(await articleCount()).toBe(SEED_ONLY + 1);
    expect(await ContentRepository.listPublications(asset.id)).toHaveLength(1);
  });

  it("allows project teammates to write and refuses client guests", () => {
    expect(() =>
      requireOrgPermission(
        { role: "project_member" },
        { integration: ["manage"] },
      ),
    ).not.toThrow();
    expect(() =>
      requireOrgPermission({ role: "scoped" }, { integration: ["manage"] }),
    ).toThrow();
    expect(() =>
      requireOrgPermission(
        { role: "project_member" },
        { workspace: ["manage"] },
      ),
    ).toThrow();
    expect(() =>
      requireOrgPermission(
        { role: "project_member" },
        { project: ["create", "delete"] },
      ),
    ).toThrow();
  });
});

describe("creating a draft", () => {
  it("creates one unpublished article and records what is needed to undo it", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    const result = await executeShopifyChange(scope, approved.id);
    const created = await shop().getArticle(result.externalId);
    expect(created).toMatchObject({
      title: "Best light roast coffee",
      isPublished: false,
    });
    expect(result.entry).toMatchObject({
      status: "executed",
      publicationStatus: "draft",
      externalId: result.externalId,
      rollbackKind: "unpublish",
    });
    expect(result.entry.diff).toContain("+ Title: Best light roast coffee");
  });

  it("reuses the article when a retry follows a lost ledger write", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    vi.spyOn(LedgerService, "recordExecution").mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(executeShopifyChange(scope, approved.id)).rejects.toThrow(
      "database unavailable",
    );
    expect(await articleCount()).toBe(SEED_ONLY + 1);
    const failed = await LedgerService.getEntry(scope.projectId, approved.id);
    expect(failed.entry.status).toBe("failed");

    // A failed change goes back through a person's approval before a retry.
    await approveShopifyChange(scope, approved.id);
    const retried = await executeShopifyChange(scope, approved.id);
    expect(retried.entry.status).toBe("executed");
    expect(await articleCount()).toBe(SEED_ONLY + 1);
    expect(await ContentRepository.listPublications(asset.id)).toHaveLength(1);
  });

  it.each([
    ["pending", null],
    ["failed", "OUTCOME_UNKNOWN: Shopify did not confirm the request"],
  ] as const)(
    "will not retry a create whose outcome is unknown (%s)",
    async (publicationState, error) => {
      const asset = await makeAsset();
      const approved = await approvedCreate(asset.id);
      const claimed = await ContentRepository.claimPublication({
        assetId: asset.id,
        revision: asset.revision,
        mode: "simulated",
        idempotencyKey: approved.idempotencyKey ?? "",
        requestedByUserId: scope.userId,
      });
      await ContentRepository.updatePublication(claimed?.id ?? "", {
        state: publicationState,
        error,
      });
      await expect(executeShopifyChange(scope, approved.id)).rejects.toThrow(
        "did not confirm whether Shopify made it",
      );
      expect(await articleCount()).toBe(SEED_ONLY);
    },
  );
});
