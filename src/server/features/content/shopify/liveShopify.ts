import { z } from "zod";
import { pickStoreBlog } from "../rules/shopifyDestination";
import { ContentRefusal } from "../rules/contentRefusal";
import type { StoreSnapshot } from "../rules/storeTypes";
import {
  articleDocument,
  articleQuerySchema,
  articleSummaryNode,
  articleUrl,
  articlesDocument,
  blogNode,
  blogsDocument,
  collectionNode,
  collectionsDocument,
  createDocument,
  createResultSchema,
  pageParser,
  parseShopify,
  productNode,
  productsDocument,
  seoMetafields,
  shopNameDocument,
  shopNameSchema,
  shopPlanDocument,
  shopPlanSchema,
  throwUserErrors,
  toDetail,
  toSummary,
  updateDocument,
  updateResultSchema,
} from "./shopifyDocuments";
import { createShopifyClient } from "./shopifyGraphql";
import type { ShopifyClient, ShopifyClientConfig } from "./shopifyGraphql";
import type {
  ArticleFields,
  ArticleInput,
  CreatedArticle,
  ShopifyStorePort,
  StoreArticleDetail,
} from "./ShopifyStorePort";
import { normalizeShopDomain } from "./shopifyOAuth";

export { normalizeShopDomain };

// Pinned and re-tested quarterly (latest stable as of 2026-11-16).
export const SHOPIFY_API_VERSION = "2026-10";

// "mock": the adapter is covered by fake-fetch tests only. "live": create
// draft, publish, update an existing article and their rollbacks (each with
// read-back) were run against a real development store on 2026-11-19. Shown in
// the connection summary so the UI never implies more certainty than exists.
export const SHOPIFY_ADAPTER_VERIFIED: "mock" | "live" = "live";

const scopesQuery = z.object({
  currentAppInstallation: z.object({
    accessScopes: z.array(z.object({ handle: z.string() })),
  }),
});

// Confirms the token works and reads the scopes it actually holds, so
// publishing is only enabled when write_content was granted.
export async function connectLiveShop(
  config: ShopifyClientConfig,
): Promise<{ shopName: string; scopes: string[] }> {
  const client = createShopifyClient(config);
  const shop = parseShopify(
    shopNameSchema,
    await client.query(shopNameDocument),
  );
  const scopes = parseShopify(
    scopesQuery,
    await client.query(
      `query { currentAppInstallation { accessScopes { handle } } }`,
    ),
  );
  return {
    shopName: shop.shop.name,
    scopes: scopes.currentAppInstallation.accessScopes.map((s) => s.handle),
  };
}

// Whether the store is a partner development store. A failed lookup counts as
// "not a development store" so it never blocks connecting.
export async function isDevelopmentShop(
  config: ShopifyClientConfig,
): Promise<boolean> {
  try {
    const answer = parseShopify(
      shopPlanSchema,
      await createShopifyClient(config).query(shopPlanDocument),
    );
    return answer.shop.plan.partnerDevelopment;
  } catch {
    return false;
  }
}

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type RichNode = { type: string; value?: string; children?: RichNode[] };
const richNode: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    value: z.string().optional(),
    children: z.array(richNode).optional(),
  }),
);

const inlineText = (node: RichNode): string =>
  node.value ?? (node.children ?? []).map(inlineText).join("");

// One line per paragraph, heading or list item of a rich text metafield.
const richLines = (node: RichNode): string[] =>
  ["paragraph", "heading", "list-item"].includes(node.type)
    ? [inlineText(node)]
    : (node.children ?? []).flatMap(richLines);

function metafieldLines(type: string, value: string): string[] {
  if (type === "rich_text_field") {
    const parsed = richNode.safeParse(safeJson(value));
    return parsed.success ? richLines(parsed.data) : [];
  }
  return type === "multi_line_text_field" || type === "single_line_text_field"
    ? value.split("\n")
    : [];
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const MAX_DETAILS_CHARS = 1500;

// Stores keep specs (age range, weight limit, size) in many places. The
// description is read separately; this reads the text metafields any store
// can define and the variant options, whatever the merchant named them.
function productDetails(product: z.infer<typeof productNode>): string {
  const fields = product.metafields.nodes.flatMap((m) => {
    const lines = metafieldLines(m.type, m.value)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length > 0 ? [`${m.key}:\n${lines.join("\n")}`] : [];
  });
  const options = product.options
    .filter((o) => o.values.length > 0 && o.values.join() !== "Default Title")
    .map((o) => `${o.name}: ${o.values.join(", ")}`);
  return [...fields, ...options].join("\n").slice(0, MAX_DETAILS_CHARS);
}

async function readBlogs(client: ShopifyClient) {
  const { nodes } = await client.readAll(
    blogsDocument,
    pageParser("blogs", blogNode),
  );
  return nodes;
}

export function createLiveShop(config: ShopifyClientConfig): ShopifyStorePort {
  const client = createShopifyClient(config);
  const { shopDomain } = config;

  async function setPublished(
    externalId: string,
    isPublished: boolean,
  ): Promise<{ url: string }> {
    const data = parseShopify(
      updateResultSchema,
      await client.query(
        updateDocument,
        { id: externalId, article: { isPublished } },
        "write",
      ),
    );
    if (data.articleUpdate.userErrors.length > 0) {
      throwUserErrors(data.articleUpdate.userErrors);
    }
    const article = data.articleUpdate.article;
    if (!article || article.isPublished !== isPublished) {
      throw new ContentRefusal(
        isPublished
          ? "Shopify did not publish the article."
          : "Shopify did not unpublish the article.",
      );
    }
    return { url: toDetail(shopDomain, article).url };
  }

  return {
    async readSnapshot(): Promise<StoreSnapshot> {
      const shop = parseShopify(
        shopNameSchema,
        await client.query(shopNameDocument),
      );
      const [products, collections, articles] = await Promise.all([
        client.readAll(productsDocument, pageParser("products", productNode)),
        client.readAll(
          collectionsDocument,
          pageParser("collections", collectionNode),
        ),
        client.readAll(
          articlesDocument,
          pageParser("articles", articleSummaryNode),
        ),
      ]);
      const truncated = (
        [
          ["products", products],
          ["collections", collections],
          ["articles", articles],
        ] as const
      )
        .filter(([, list]) => list.truncated)
        .map(([name]) => name);
      return {
        truncated,
        shopName: shop.shop.name,
        products: products.nodes.map((p) => ({
          handle: p.handle,
          title: p.title,
          description: stripHtml(p.descriptionHtml),
          available: p.status === "ACTIVE" && p.totalInventory > 0,
          details: productDetails(p),
          images: p.images.nodes.map((i) => ({
            url: i.url,
            alt: i.altText ?? "",
          })),
        })),
        collections: collections.nodes,
        articles: articles.nodes.map((a) => ({
          handle: a.handle,
          title: a.title,
          blogHandle: a.blog.handle,
        })),
      };
    },

    async readShopName() {
      const shop = parseShopify(
        shopNameSchema,
        await client.query(shopNameDocument),
      );
      return shop.shop.name;
    },

    listBlogs: () => readBlogs(client),

    async listArticles() {
      const { nodes } = await client.readAll(
        articlesDocument,
        pageParser("articles", articleSummaryNode),
      );
      return nodes.map((n) => toSummary(shopDomain, n));
    },

    async getArticle(externalId: string): Promise<StoreArticleDetail | null> {
      const data = parseShopify(
        articleQuerySchema,
        await client.query(articleDocument, { id: externalId }),
      );
      return data.article ? toDetail(shopDomain, data.article) : null;
    },

    // Shopify has no idempotency header for this mutation, so the guarantee
    // lives in our content_publications row (claimed before this is called).
    async createDraftArticle(input: ArticleInput): Promise<CreatedArticle> {
      const blog = pickStoreBlog(await readBlogs(client), input.blogId);
      const data = parseShopify(
        createResultSchema,
        await client.query(
          createDocument,
          {
            article: {
              blogId: blog.id,
              title: input.title,
              author: { name: input.authorName },
              body: input.bodyHtml,
              isPublished: false,
              metafields: seoMetafields(input),
            },
          },
          "write",
        ),
      );
      if (data.articleCreate.userErrors.length > 0) {
        throwUserErrors(data.articleCreate.userErrors);
      }
      const article = data.articleCreate.article;
      if (!article) {
        throw new ContentRefusal("Shopify did not return the new article.");
      }
      return {
        externalId: article.id,
        handle: article.handle,
        url: articleUrl(shopDomain, blog.handle, article.handle),
      };
    },

    // Writes text only. The published flag is not sent, so an update never
    // changes whether the article is public.
    async updateArticle(
      externalId: string,
      fields: ArticleFields,
    ): Promise<StoreArticleDetail> {
      const data = parseShopify(
        updateResultSchema,
        await client.query(
          updateDocument,
          {
            id: externalId,
            article: {
              title: fields.title,
              body: fields.bodyHtml,
              metafields: seoMetafields(fields),
            },
          },
          "write",
        ),
      );
      if (data.articleUpdate.userErrors.length > 0) {
        throwUserErrors(data.articleUpdate.userErrors);
      }
      if (!data.articleUpdate.article) {
        throw new ContentRefusal("Shopify did not return the updated article.");
      }
      return toDetail(shopDomain, data.articleUpdate.article);
    },

    publishArticle: (externalId: string) => setPublished(externalId, true),
    unpublishArticle: (externalId: string) => setPublished(externalId, false),

    // UNVERIFIED LIVE. Shopify's documented way for an app to drop its own
    // access is `DELETE /admin/api_permissions/current.json` with the token
    // (it uninstalls the app and invalidates the token). This has only been
    // run against a fake fetch, never a real store, and Shopify has been
    // moving app-lifecycle calls to other endpoints, so a refusal is reported
    // honestly as "not confirmed" instead of being treated as success. A 401
    // means the token is already dead, which is the outcome we want.
    async revokeAccess() {
      const note =
        "Disconnected here. Revoking the token at Shopify was not confirmed: remove the app in the Shopify admin.";
      try {
        const response = await fetch(
          `https://${shopDomain}/admin/api_permissions/current.json`,
          {
            method: "DELETE",
            headers: { "X-Shopify-Access-Token": config.accessToken },
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (response.ok || response.status === 401) {
          return {
            revoked: true,
            note: "Disconnected and revoked at Shopify.",
          };
        }
        return { revoked: false, note };
      } catch {
        return { revoked: false, note };
      }
    },
  };
}
