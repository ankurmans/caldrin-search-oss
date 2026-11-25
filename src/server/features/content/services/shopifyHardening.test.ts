import { beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { ContentRepository } from "../repositories/ContentRepository";
import { ContentRefusal } from "../rules/contentRefusal";
import { ShopifyOutcomeUnknown } from "../shopify/shopifyGraphql";
import * as connection from "./shopifyConnection";
import { resetDatabase } from "./contentTestDb";
import {
  approveShopifyChange,
  proposeShopifyChange,
} from "./shopifyChangePlan";
import {
  approvedCreate,
  articleCount,
  connect,
  makeAsset,
  scope,
  shop,
} from "./shopifyChangeTestSupport";
import { executeShopifyChange } from "./shopifyExecution";
import { rollbackShopifyChange } from "./shopifyRollback";
import { ContentService } from "./ContentService";

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

beforeEach(async () => {
  resetDatabase();
  await connect();
});

// The draft is approved for its current revision, as the approval screen does.
async function approvedAsset() {
  const asset = await makeAsset();
  await ContentRepository.approveAsset(
    scope.projectId,
    asset.id,
    asset.revision,
    scope.userId,
  );
  return asset;
}

async function createThenPublish(assetId: string) {
  const create = await approvedCreate(assetId);
  const created = await executeShopifyChange(scope, create.id);
  const { entry } = await proposeShopifyChange(scope, assetId, {
    action: "publish_draft",
  });
  const approved = await approveShopifyChange(scope, entry.id);
  const published = await executeShopifyChange(scope, approved.id);
  return { create, created, published };
}

describe("publishing", () => {
  it("rolling back the create also marks the published copy unpublished", async () => {
    const asset = await approvedAsset();
    const { create, created } = await createThenPublish(asset.id);
    expect((await shop().getArticle(created.externalId))?.isPublished).toBe(
      true,
    );

    await rollbackShopifyChange(scope, create.id);

    expect((await shop().getArticle(created.externalId))?.isPublished).toBe(
      false,
    );
    const publications = await ContentRepository.listPublications(asset.id);
    expect(publications.every((p) => p.state !== "published")).toBe(true);
    expect(
      (await ContentRepository.getAsset(scope.projectId, asset.id))?.status,
    ).toBe("approved");
  });

  it("does not report a publish Shopify does not read back as published", async () => {
    const asset = await approvedAsset();
    const create = await approvedCreate(asset.id);
    const created = await executeShopifyChange(scope, create.id);
    const { entry } = await proposeShopifyChange(scope, asset.id, {
      action: "publish_draft",
    });
    const approved = await approveShopifyChange(scope, entry.id);
    const real = await connection.storeForProject(scope.projectId);
    vi.spyOn(connection, "storeForProject").mockResolvedValue({
      ...real,
      publishArticle: () => Promise.resolve({ url: "https://x.test/a" }),
    });
    await expect(
      executeShopifyChange(scope, approved.id),
    ).rejects.toBeInstanceOf(ShopifyOutcomeUnknown);
    const publications = await ContentRepository.listPublications(asset.id);
    expect(
      publications.find((p) => p.externalId === created.externalId)?.state,
    ).not.toBe("published");
  });
});

describe("proposing again", () => {
  it("starts a new create after a rejection and still publishes that article", async () => {
    const asset = await approvedAsset();
    const first = await proposeShopifyChange(scope, asset.id);
    await LedgerService.rejectChange(scope, first.entry.id, "not yet");
    const second = await proposeShopifyChange(scope, asset.id);
    expect(second.entry.id).not.toBe(first.entry.id);
    expect(second.entry.status).toBe("proposed");

    const approved = await approveShopifyChange(scope, second.entry.id);
    const created = await executeShopifyChange(scope, approved.id);
    const { entry } = await proposeShopifyChange(scope, asset.id, {
      action: "publish_draft",
    });
    const publish = await approveShopifyChange(scope, entry.id);
    const published = await executeShopifyChange(scope, publish.id);
    expect(published.externalId).toBe(created.externalId);
  });

  it("refuses to repeat a create that was rolled back", async () => {
    const asset = await approvedAsset();
    const create = await approvedCreate(asset.id);
    await executeShopifyChange(scope, create.id);
    await rollbackShopifyChange(scope, create.id);
    await expect(proposeShopifyChange(scope, asset.id)).rejects.toBeInstanceOf(
      ContentRefusal,
    );
  });
});

describe("an unconfirmed create", () => {
  it("lets a person adopt the article Shopify made instead of creating another", async () => {
    const asset = await approvedAsset();
    const approved = await approvedCreate(asset.id);
    const claimed = await ContentRepository.claimPublication({
      assetId: asset.id,
      revision: asset.revision,
      mode: "simulated",
      idempotencyKey: approved.idempotencyKey ?? "",
      requestedByUserId: scope.userId,
    });
    await ContentRepository.updatePublication(claimed?.id ?? "", {
      state: "failed",
      error: "OUTCOME_UNKNOWN: Shopify did not confirm the request",
    });
    const made = await shop().createDraftArticle(
      {
        authorName: "x",
        title: asset.title,
        bodyHtml: asset.bodyHtml,
        metaTitle: asset.metaTitle,
        metaDescription: asset.metaDescription,
      },
      "lost-answer",
    );
    const before = await articleCount();

    const result = await executeShopifyChange(scope, approved.id, {
      adoptExternalId: made.externalId,
    });

    expect(result.externalId).toBe(made.externalId);
    expect(await articleCount()).toBe(before);
  });

  it("refuses to adopt when no earlier attempt is waiting on Shopify", async () => {
    const asset = await approvedAsset();
    const approved = await approvedCreate(asset.id);
    const before = await articleCount();
    await expect(
      executeShopifyChange(scope, approved.id, {
        adoptExternalId: "gid://shopify/Article/1",
      }),
    ).rejects.toBeInstanceOf(ContentRefusal);
    expect(await articleCount()).toBe(before);
  });

  it("refuses to adopt an article that is public or has another title", async () => {
    const asset = await approvedAsset();
    const approved = await approvedCreate(asset.id);
    const claimed = await ContentRepository.claimPublication({
      assetId: asset.id,
      revision: asset.revision,
      mode: "simulated",
      idempotencyKey: approved.idempotencyKey ?? "",
      requestedByUserId: scope.userId,
    });
    await ContentRepository.updatePublication(claimed?.id ?? "", {
      state: "pending",
    });
    const [seed] = await shop().listArticles();
    await expect(
      executeShopifyChange(scope, approved.id, {
        adoptExternalId: seed?.externalId ?? "",
      }),
    ).rejects.toBeInstanceOf(ContentRefusal);
  });
});

describe("the blog for new articles", () => {
  it("only accepts a blog the store has", async () => {
    const [blog] = await shop().listBlogs();
    await expect(
      ContentService.setShopifyBlog(scope.projectId, "gid://shopify/Blog/0"),
    ).rejects.toBeInstanceOf(ContentRefusal);

    await ContentService.setShopifyBlog(scope.projectId, blog?.id ?? "");
    expect(
      (await ContentService.getConnectionSummary(scope.projectId))?.blogId,
    ).toBe(blog?.id);
  });
});

describe("auto-publish", () => {
  it("cannot be turned on for a demo store, and can always be turned off", async () => {
    await expect(
      connection.setAutoPublish(scope.projectId, true),
    ).rejects.toBeInstanceOf(ContentRefusal);
    await connection.setAutoPublish(scope.projectId, false);
    expect(
      (await ContentService.getConnectionSummary(scope.projectId))?.autoPublish,
    ).toBe(false);
  });
});
