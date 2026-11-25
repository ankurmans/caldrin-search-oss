import { ContentRepository } from "../repositories/ContentRepository";
import type { ContentAsset } from "../repositories/ContentRepository";
import { ContentRefusal } from "../rules/contentRefusal";
import { actionFromKey } from "../rules/publishPolicy";
import { hasBlockingFailure, runQualityChecks } from "../rules/qualityChecks";
import { ShopifyOutcomeUnknown } from "../shopify/shopifyGraphql";
import type {
  ShopifyStorePort,
  StoreArticleDetail,
} from "../shopify/ShopifyStorePort";

// Shopify answered, but the write is only trusted once it reads back.
export async function readBack(
  store: ShopifyStorePort,
  externalId: string,
  holds: (article: StoreArticleDetail) => boolean,
  what: string,
): Promise<StoreArticleDetail> {
  const article = await store.getArticle(externalId);
  if (!article || !holds(article)) {
    throw new ShopifyOutcomeUnknown(
      `${what} was accepted but does not read back from the store`,
    );
  }
  return article;
}

// A person found the article an unconfirmed create made. It must be a draft
// with this draft's title that no other publication already owns.
export async function adopt(
  asset: ContentAsset,
  store: ShopifyStorePort,
  externalId: string,
) {
  const found = await store.getArticle(externalId);
  if (!found) {
    throw new ContentRefusal("That article was not found in the store.");
  }
  if (found.isPublished || found.title !== asset.title) {
    throw new ContentRefusal(
      "Only an unpublished article with this draft's title can be adopted.",
    );
  }
  const owners = await ContentRepository.listPublications(asset.id);
  if (owners.some((p) => p.externalId === externalId)) {
    throw new ContentRefusal("That article is already linked to this draft.");
  }
  return found;
}

// The checks stored at approval were run against the store as it was then.
// Products and collections change, so a publish runs them again.
export async function requireFreshQualityChecks(
  asset: ContentAsset,
  store: ShopifyStorePort,
) {
  const checks = runQualityChecks(asset, await store.readSnapshot());
  if (hasBlockingFailure(checks)) {
    const failed = checks
      .filter((c) => c.severity === "block" && !c.passed)
      .map((c) => c.key)
      .join(", ");
    throw new ContentRefusal(
      `Nothing was published. Quality checks now fail against the store: ${failed}. Edit the draft and approve it again.`,
    );
  }
}

// The article this revision's create made. A create proposed again after a
// rejection runs under a later key, so the base key alone is not enough.
export async function findCreatedArticle(assetId: string, revision: number) {
  const publications = await ContentRepository.listPublications(assetId);
  const found = publications
    .filter(
      (p) =>
        p.revision === revision &&
        actionFromKey(p.idempotencyKey) === "create_draft" &&
        p.externalId &&
        p.state !== "failed",
    )
    .at(-1);
  return found ?? null;
}
