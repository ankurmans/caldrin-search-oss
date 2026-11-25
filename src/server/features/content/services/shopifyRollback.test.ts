import { beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { LedgerRefusal } from "@/server/features/ledger/types";
import { ContentRepository } from "../repositories/ContentRepository";
import { ContentRefusal } from "../rules/contentRefusal";
import { SIMULATED_SEED_ARTICLE_ID } from "../shopify/simulatedShop";
import { resetDatabase, selectAll } from "./contentTestDb";
import {
  approveShopifyChange,
  proposeShopifyChange,
} from "./shopifyChangePlan";
import {
  approvedCreate,
  approvedUpdate,
  confirmed,
  connect,
  connectLive,
  makeAsset,
  scope,
  shop,
} from "./shopifyChangeTestSupport";
import {
  disconnectShopify,
  getConnectionSummary,
  storeForProject,
} from "./shopifyConnection";
import { executeShopifyChange } from "./shopifyExecution";
import { rollbackShopifyChange } from "./shopifyRollback";

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

describe("updating an existing article", () => {
  it("needs an explicit confirmation and writes nothing without it", async () => {
    const asset = await makeAsset();
    const approved = await approvedUpdate(asset.id);
    await expect(
      executeShopifyChange(scope, approved.id, {
        targetExternalId: SIMULATED_SEED_ARTICLE_ID,
      }),
    ).rejects.toBeInstanceOf(ContentRefusal);
    expect((await shop().getArticle(SIMULATED_SEED_ARTICLE_ID))?.title).toBe(
      "Pour Over Brew Guide",
    );
    const after = await LedgerService.getEntry(scope.projectId, approved.id);
    expect(after.entry.status).toBe("approved");
  });

  it("writes the approved text and records the applied difference", async () => {
    const asset = await makeAsset();
    const approved = await approvedUpdate(asset.id);
    const result = await executeShopifyChange(scope, approved.id, confirmed);
    const live = await shop().getArticle(SIMULATED_SEED_ARTICLE_ID);
    expect(live).toMatchObject({
      title: "Best light roast coffee",
      isPublished: true,
    });
    expect(result.entry).toMatchObject({
      status: "executed",
      rollbackKind: "restore_previous_content",
    });
    expect(result.entry.diff).toContain("- Title: Pour Over Brew Guide");
  });

  it("refuses to overwrite an article edited after the proposal", async () => {
    const asset = await makeAsset();
    const approved = await approvedUpdate(asset.id);
    const live = await shop().getArticle(SIMULATED_SEED_ARTICLE_ID);
    await shop().updateArticle(SIMULATED_SEED_ARTICLE_ID, {
      title: live?.title ?? "",
      bodyHtml: "<p>Edited by the merchant</p>",
      metaTitle: live?.metaTitle ?? "",
      metaDescription: live?.metaDescription ?? "",
    });
    await expect(
      executeShopifyChange(scope, approved.id, confirmed),
    ).rejects.toThrow("changed in Shopify");
    expect((await shop().getArticle(SIMULATED_SEED_ARTICLE_ID))?.bodyHtml).toBe(
      "<p>Edited by the merchant</p>",
    );
  });
});

describe("rolling back", () => {
  async function executedUpdate() {
    const asset = await makeAsset();
    const approved = await approvedUpdate(asset.id);
    const before = await shop().getArticle(SIMULATED_SEED_ARTICLE_ID);
    await executeShopifyChange(scope, approved.id, confirmed);
    return { asset, entryId: approved.id, before };
  }

  it("restores the previous text exactly", async () => {
    const { entryId, before } = await executedUpdate();
    const result = await rollbackShopifyChange(scope, entryId);
    expect(result.status).toBe("rolled_back");
    expect(await shop().getArticle(SIMULATED_SEED_ARTICLE_ID)).toEqual(before);
    const after = await LedgerService.getEntry(scope.projectId, entryId);
    expect(after.entry.status).toBe("rolled_back");
  });

  it("will not erase edits made in Shopify since, unless told to", async () => {
    const { entryId, before } = await executedUpdate();
    const live = await shop().getArticle(SIMULATED_SEED_ARTICLE_ID);
    await shop().updateArticle(SIMULATED_SEED_ARTICLE_ID, {
      title: live?.title ?? "",
      bodyHtml: "<p>Later edit</p>",
      metaTitle: live?.metaTitle ?? "",
      metaDescription: live?.metaDescription ?? "",
    });
    await expect(rollbackShopifyChange(scope, entryId)).rejects.toThrow(
      "edited in Shopify after this change",
    );
    expect((await shop().getArticle(SIMULATED_SEED_ARTICLE_ID))?.bodyHtml).toBe(
      "<p>Later edit</p>",
    );
    await rollbackShopifyChange(scope, entryId, { overwriteLaterEdits: true });
    expect(await shop().getArticle(SIMULATED_SEED_ARTICLE_ID)).toEqual(before);
  });

  it("is refused for a change that was never executed", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    await expect(
      rollbackShopifyChange(scope, approved.id),
    ).rejects.toBeInstanceOf(LedgerRefusal);
  });

  it("unpublishes a published draft and keeps our records honest", async () => {
    const asset = await makeAsset();
    const created = await executeShopifyChange(
      scope,
      (await approvedCreate(asset.id)).id,
    );
    const { entry: publishEntry } = await proposeShopifyChange(
      scope,
      asset.id,
      {
        action: "publish_draft",
      },
    );
    await approveShopifyChange(scope, publishEntry.id);
    await executeShopifyChange(scope, publishEntry.id);
    expect((await shop().getArticle(created.externalId))?.isPublished).toBe(
      true,
    );
    expect(
      (await ContentRepository.getAsset(scope.projectId, asset.id))?.status,
    ).toBe("published");

    await rollbackShopifyChange(scope, publishEntry.id);
    expect((await shop().getArticle(created.externalId))?.isPublished).toBe(
      false,
    );
    expect(
      (await ContentRepository.getAsset(scope.projectId, asset.id))?.status,
    ).toBe("approved");
    const publication = await ContentRepository.findPublication(
      publishEntry.idempotencyKey ?? "",
    );
    expect(publication?.state).toBe("draft_created");
  });

  it("says so when Shopify cannot restore it, and changes nothing", async () => {
    const bare = await shop().createDraftArticle(
      {
        authorName: "x",
        title: "No SEO text yet",
        bodyHtml: "<p>old</p>",
        metaTitle: "",
        metaDescription: "",
      },
      "seed-bare",
    );
    const asset = await makeAsset();
    const { entry } = await proposeShopifyChange(scope, asset.id, {
      targetExternalId: bare.externalId,
    });
    await approveShopifyChange(scope, entry.id);
    await executeShopifyChange(scope, entry.id, {
      confirmUpdate: true,
      targetExternalId: bare.externalId,
    });
    const executed = await LedgerService.getEntry(scope.projectId, entry.id);
    expect(executed.entry.rollbackKind).toBe("manual");

    const result = await rollbackShopifyChange(scope, entry.id);
    expect(result.status).toBe("manual");
    expect((await shop().getArticle(bare.externalId))?.title).toBe(
      "Best light roast coffee",
    );
    const still = await LedgerService.getEntry(scope.projectId, entry.id);
    expect(still.entry.status).toBe("executed");

    const done = await rollbackShopifyChange(scope, entry.id, {
      manuallyRestored: true,
    });
    expect(done.status).toBe("rolled_back");
  });
});

describe("disconnecting", () => {
  it("removes the sealed tokens and the store can no longer be reached", async () => {
    const fetchSpy = await connectLive(["read_content", "write_content"]);
    expect(
      JSON.stringify(await getConnectionSummary(scope.projectId)),
    ).not.toMatch(/shpat|sealed/);
    await expect(storeForProject(scope.projectId)).resolves.toBeDefined();

    await disconnectShopify(scope.projectId);

    expect(selectAll("shopify_connections")).toEqual([]);
    expect(JSON.stringify(selectAll("shopify_connections"))).not.toMatch(
      /sealed/,
    );
    expect(await getConnectionSummary(scope.projectId)).toBeNull();
    await expect(storeForProject(scope.projectId)).rejects.toThrow(
      "Connect a Shopify store first",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stops an approved change from running against a disconnected store", async () => {
    const asset = await makeAsset();
    const approved = await approvedCreate(asset.id);
    await disconnectShopify(scope.projectId);
    await expect(executeShopifyChange(scope, approved.id)).rejects.toThrow(
      "Connect a Shopify store first",
    );
  });
});
