import type { StoreSnapshot } from "../rules/storeTypes";

export type ArticleInput = {
  // Shown publicly as the article author; the service passes the store name.
  authorName: string;
  title: string;
  bodyHtml: string;
  metaTitle: string;
  metaDescription: string;
  // The blog to create into. Omitted: the "news" blog, else the first blog.
  blogId?: string;
};

// The editable text of an article. This is exactly what an update writes and
// what a rollback restores.
export type ArticleFields = {
  title: string;
  bodyHtml: string;
  metaTitle: string;
  metaDescription: string;
};

export type CreatedArticle = {
  externalId: string;
  handle: string;
  url: string;
};

export type StoreBlog = { id: string; handle: string; title: string };

export type StoreArticleSummary = {
  externalId: string;
  handle: string;
  title: string;
  blogHandle: string;
  isPublished: boolean;
  url: string;
};

// An article as it is in the store right now. `isPublished` is part of the
// state because a rollback must put it back.
export type StoreArticleDetail = StoreArticleSummary &
  ArticleFields & { blogId: string };

// The only surface the content workflow uses to talk to a store. The live
// implementation calls the Shopify Admin GraphQL API; the simulated one never
// leaves the process. Creation is idempotent per `idempotencyKey`; update,
// publish and unpublish are idempotent by nature (they set a state).
//
// Every method that writes is called only after LedgerService.beginExecution
// (or beginRollback) succeeded. Nothing else in the code base calls them.
export interface ShopifyStorePort {
  readSnapshot(): Promise<StoreSnapshot>;
  // One cheap call, for the article author name on create.
  readShopName(): Promise<string>;
  listBlogs(): Promise<StoreBlog[]>;
  listArticles(): Promise<StoreArticleSummary[]>;
  // null when the article no longer exists.
  getArticle(externalId: string): Promise<StoreArticleDetail | null>;
  createDraftArticle(
    input: ArticleInput,
    idempotencyKey: string,
  ): Promise<CreatedArticle>;
  updateArticle(
    externalId: string,
    fields: ArticleFields,
  ): Promise<StoreArticleDetail>;
  publishArticle(
    externalId: string,
    idempotencyKey: string,
  ): Promise<{ url: string }>;
  // Sets isPublished=false. The article stays in the store as a draft: this
  // adapter never deletes anything.
  unpublishArticle(externalId: string): Promise<{ url: string }>;
  // Best-effort revocation of the access token at Shopify, used on
  // disconnect. Never throws: `revoked` is true only when Shopify confirmed
  // the token is gone. UNVERIFIED LIVE: see liveShopify.ts.
  revokeAccess(): Promise<{ revoked: boolean; note: string }>;
}
