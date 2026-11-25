import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { changeLedgerEntries } from "@/db/schema";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { ContentRepository } from "../repositories/ContentRepository";
import { SIMULATED_SEED_ARTICLE_ID } from "../shopify/simulatedShop";
import { resetDatabase } from "./contentTestDb";
import {
  SEED_ONLY,
  approvedCreate,
  approvedUpdate,
  articleCount,
  confirmed,
  connect,
  makeAsset,
  scope,
  shop,
} from "./shopifyChangeTestSupport";
import { approveShopifyChange } from "./shopifyChangePlan";
import { executeShopifyChange } from "./shopifyExecution";
import {
  markShopifyChangeNotApplied,
  reconcileShopifyChange,
  reconcileStuckExecutions,
} from "./shopifyReconcile";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => (await import("./contentTestDb")).contentDbMock());
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: vi.fn() },
}));
vi.mock("@/server/lib/secret-box", () => ({
  sealSecret: (plain: string) => Promise.resolve(`sealed(${plain})`),
  openSecret: (sealed: string) =>
    Promise.resolve(/^sealed\((.*)\)$/.exec(sealed)?.[1] ?? null),
}));

const OPTS = { olderThanMinutes: 5, projectId: scope.projectId };

beforeEach(async () => {
  resetDatabase();
  await connect();
});

// The Worker died after this point: the entry is executing and the publication
// is claimed, but nothing was recorded.
async function crashAfterClaim(
  assetId: string,
  revision: number,
  entryId: string,
  ageMinutes = 30,
) {
  await LedgerService.beginExecution(scope, entryId);
  const { entry } = await LedgerService.getEntry(scope.projectId, entryId);
  const claimed = await ContentRepository.claimPublication({
    assetId,
    revision,
    mode: "simulated",
    idempotencyKey: entry.idempotencyKey ?? "",
    requestedByUserId: scope.userId,
  });
  const old = new Date(Date.now() - ageMinutes * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  await db
    .update(changeLedgerEntries)
    .set({ updatedAt: old })
    .where(eq(changeLedgerEntries.id, entryId));
  return claimed;
}

const status = async (entryId: string) =>
  (await LedgerService.getEntry(scope.projectId, entryId)).entry;

describe("an update the Worker died during", () => {
  it("is recorded as executed when Shopify holds the approved text", async () => {
    const asset = await makeAsset();
    const approved = await approvedUpdate(asset.id);
    await crashAfterClaim(asset.id, asset.revision, approved.id);
    await shop().updateArticle(SIMULATED_SEED_ARTICLE_ID, {
      title: asset.title,
      bodyHtml: asset.bodyHtml,
      metaTitle: asset.metaTitle,
      metaDescription: asset.metaDescription,
    });

    const totals = await reconcileStuckExecutions(OPTS);

    expect(totals).toEqual({
      checked: 1,
      markedExecuted: 1,
      markedFailed: 0,
      needsReview: 0,
    });
    const entry = await status(approved.id);
    expect(entry.status).toBe("executed");
    expect(entry.afterState).toContain("Title: Best light roast coffee");
    // The previous text was lost with the Worker, so no restore is promised.
    expect(entry.rollbackKind).toBe("none");
  });

  it("is marked failed, and can be approved and run again, when Shopify still has the old text", async () => {
    const asset = await makeAsset();
    const approved = await approvedUpdate(asset.id);
    await crashAfterClaim(asset.id, asset.revision, approved.id);

    const totals = await reconcileStuckExecutions(OPTS);

    expect(totals.markedFailed).toBe(1);
    expect((await shop().getArticle(SIMULATED_SEED_ARTICLE_ID))?.title).toBe(
      "Pour Over Brew Guide",
    );
    const failed = await status(approved.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("did not land");

    await approveShopifyChange(scope, approved.id);
    const retried = await executeShopifyChange(scope, approved.id, confirmed);
    expect(retried.entry.status).toBe("executed");
  });

  it("is left for review when the article matches neither text", async () => {
    const asset = await makeAsset();
    const approved = await approvedUpdate(asset.id);
    await crashAfterClaim(asset.id, asset.revision, approved.id);
    await shop().updateArticle(SIMULATED_SEED_ARTICLE_ID, {
      title: "Someone else's edit",
      bodyHtml: "<p>x</p>",
      metaTitle: "m",
      metaDescription: "d",
    });

    const totals = await reconcileStuckExecutions(OPTS);

    expect(totals.needsReview).toBe(1);
    const entry = await status(approved.id);
    expect(entry.status).toBe("executing");
    expect(entry.error).toContain("NEEDS_REVIEW");
  });
});

describe("a create the Worker died during", () => {
  it("is recorded as executed when the draft exists and its id was saved", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    const publication = await crashAfterClaim(
      asset.id,
      asset.revision,
      approved.id,
    );
    const created = await shop().createDraftArticle(
      {
        authorName: "Demo",
        title: asset.title,
        bodyHtml: asset.bodyHtml,
        metaTitle: asset.metaTitle,
        metaDescription: asset.metaDescription,
      },
      approved.idempotencyKey ?? "",
    );
    await ContentRepository.updatePublication(publication?.id ?? "", {
      state: "draft_created",
      externalId: created.externalId,
      externalUrl: created.url,
    });

    const totals = await reconcileStuckExecutions(OPTS);

    expect(totals.markedExecuted).toBe(1);
    const entry = await status(approved.id);
    expect(entry).toMatchObject({
      status: "executed",
      externalId: created.externalId,
      rollbackKind: "unpublish",
    });
  });

  it("is never guessed at when Shopify's answer was lost: left for review, nothing written", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    await crashAfterClaim(asset.id, asset.revision, approved.id);

    const totals = await reconcileStuckExecutions(OPTS);

    expect(totals).toMatchObject({ markedExecuted: 0, needsReview: 1 });
    expect((await status(approved.id)).status).toBe("executing");
    expect(await articleCount()).toBe(SEED_ONLY);
  });

  it("can be recorded as not applied by a person after the check, then approved and run again", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    await crashAfterClaim(asset.id, asset.revision, approved.id);
    await expect(
      markShopifyChangeNotApplied(scope, approved.id),
    ).rejects.toThrow(/Check what happened first/);

    await reconcileStuckExecutions(OPTS);
    // Another project cannot resolve this project's change.
    await expect(
      markShopifyChangeNotApplied(
        { ...scope, projectId: "project-b", userId: "user-b" },
        approved.id,
      ),
    ).rejects.toThrow();
    expect((await status(approved.id)).status).toBe("executing");
    const marked = await markShopifyChangeNotApplied(scope, approved.id);

    expect(marked).toMatchObject({
      status: "failed",
      finalDecidedByUserId: scope.userId,
    });
    expect(await articleCount()).toBe(SEED_ONLY);
    await approveShopifyChange(scope, approved.id);
    const retried = await executeShopifyChange(scope, approved.id, confirmed);
    expect(retried.entry.status).toBe("executed");
    expect(await articleCount()).toBe(SEED_ONLY + 1);
  });

  it("is recorded as executed when exactly one unclaimed draft has the approved text", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    await crashAfterClaim(asset.id, asset.revision, approved.id);
    await shop().createDraftArticle(
      {
        authorName: "Demo",
        title: asset.title,
        bodyHtml: asset.bodyHtml,
        metaTitle: asset.metaTitle,
        metaDescription: asset.metaDescription,
      },
      "lost-answer",
    );

    const totals = await reconcileStuckExecutions(OPTS);

    expect(totals.markedExecuted).toBe(1);
    expect(await articleCount()).toBe(SEED_ONLY + 1);
  });

  it("is left for review when the store is no longer connected", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    await crashAfterClaim(asset.id, asset.revision, approved.id);
    await ContentRepository.deleteConnection(scope.projectId);

    const totals = await reconcileStuckExecutions(OPTS);

    expect(totals.needsReview).toBe(1);
    expect((await status(approved.id)).status).toBe("executing");
  });
});

describe("which changes are checked", () => {
  it("skips a change that started recently and refuses a manual check of it", async () => {
    const asset = await makeAsset();
    const approved = await approvedUpdate(asset.id);
    await crashAfterClaim(asset.id, asset.revision, approved.id, 1);

    expect((await reconcileStuckExecutions(OPTS)).checked).toBe(0);
    await expect(
      reconcileShopifyChange(scope.projectId, approved.id),
    ).rejects.toThrow("may still be running");
  });

  it("checks one change on request and reports what it found", async () => {
    const asset = await makeAsset();
    const approved = await approvedUpdate(asset.id);
    await crashAfterClaim(asset.id, asset.revision, approved.id);

    const result = await reconcileShopifyChange(scope.projectId, approved.id);

    expect(result.outcome).toBe("failed");
    await expect(
      reconcileShopifyChange(scope.projectId, approved.id),
    ).rejects.toThrow("not stuck");
  });
});
