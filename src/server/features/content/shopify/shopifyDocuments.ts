import { z } from "zod";
import { ContentRefusal } from "../rules/contentRefusal";
import type { Page } from "./shopifyGraphql";
import type {
  StoreArticleDetail,
  StoreArticleSummary,
} from "./ShopifyStorePort";

// GraphQL documents and response schemas for the SEO-relevant slice of a
// store: products, collections, blogs, articles. No orders, no customers.
//
// VERIFICATION: `verified: "mock"`. Field names below follow the Admin GraphQL
// Article / Blog / Product objects as documented, but every one of them has only
// been exercised against a fake fetch. Not confirmed against a live store:
//   - the top-level `articles` / `article(id:)` roots (API 2026-10)
//   - `ArticleUpdateInput.metafields` accepting global.title_tag and
//     global.description_tag (create writes them the same way)
// If a live store rejects one, it fails here (a ContentRefusal with Shopify's
// message), never silently.

const pageInfo = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

function connection<T extends z.ZodType>(node: T) {
  return z.object({ nodes: z.array(node), pageInfo });
}

export function parseShopify<T extends z.ZodType>(
  schema: T,
  data: unknown,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const where = result.error.issues[0]?.path.join(".") ?? "response";
    throw new ContentRefusal(
      `Shopify returned data in an unexpected shape (${where}).`,
    );
  }
  return result.data;
}

export function pageParser<T extends z.ZodType>(key: string, node: T) {
  const schema = z.record(z.string(), connection(node));
  return (data: unknown): Page<z.infer<T>> => {
    const connectionData = parseShopify(schema, data)[key];
    if (!connectionData) {
      throw new ContentRefusal(`Shopify returned no "${key}" list.`);
    }
    return connectionData;
  };
}

export const shopNameDocument = `query { shop { name } }`;
export const shopNameSchema = z.object({
  shop: z.object({ name: z.string() }),
});

export const shopPlanDocument = `query { shop { plan { partnerDevelopment } } }`;
export const shopPlanSchema = z.object({
  shop: z.object({ plan: z.object({ partnerDevelopment: z.boolean() }) }),
});

export const productsDocument = `query Products($after: String) {
  products(first: 50, after: $after, query: "status:active") {
    nodes { handle title descriptionHtml totalInventory status images(first: 3) { nodes { url altText } } options { name values } metafields(first: 10) { nodes { key type value } } }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const productNode = z.object({
  handle: z.string(),
  title: z.string(),
  descriptionHtml: z.string(),
  totalInventory: z.number(),
  status: z.string(),
  images: z.object({
    nodes: z.array(
      z.object({ url: z.string(), altText: z.string().nullable() }),
    ),
  }),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  metafields: z.object({
    nodes: z.array(
      z.object({ key: z.string(), type: z.string(), value: z.string() }),
    ),
  }),
});

export const collectionsDocument = `query Collections($after: String) {
  collections(first: 100, after: $after) {
    nodes { handle title }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const collectionNode = z.object({
  handle: z.string(),
  title: z.string(),
});

export const blogsDocument = `query Blogs($after: String) {
  blogs(first: 100, after: $after) {
    nodes { id handle title }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const blogNode = z.object({
  id: z.string(),
  handle: z.string(),
  title: z.string(),
});

const articleFields = `id handle title body isPublished
    blog { id handle }
    titleTag: metafield(namespace: "global", key: "title_tag") { value }
    descriptionTag: metafield(namespace: "global", key: "description_tag") { value }`;

export const articlesDocument = `query Articles($after: String) {
  articles(first: 100, after: $after) {
    nodes { id handle title isPublished blog { handle } }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const articleSummaryNode = z.object({
  id: z.string(),
  handle: z.string(),
  title: z.string(),
  isPublished: z.boolean(),
  blog: z.object({ handle: z.string() }),
});

export const articleDocument = `query Article($id: ID!) { article(id: $id) { ${articleFields} } }`;

const metafieldValue = z.object({ value: z.string() }).nullable();
const articleNode = z.object({
  id: z.string(),
  handle: z.string(),
  title: z.string(),
  body: z.string(),
  isPublished: z.boolean(),
  blog: z.object({ id: z.string(), handle: z.string() }),
  titleTag: metafieldValue,
  descriptionTag: metafieldValue,
});
export const articleQuerySchema = z.object({ article: articleNode.nullable() });

const userErrors = z.array(
  z.object({ code: z.string().nullable().optional(), message: z.string() }),
);

export const createDocument = `mutation CreateDraft($article: ArticleCreateInput!) {
  articleCreate(article: $article) {
    article { id handle isPublished }
    userErrors { code message }
  }
}`;
export const createResultSchema = z.object({
  articleCreate: z.object({
    article: z
      .object({ id: z.string(), handle: z.string(), isPublished: z.boolean() })
      .nullable(),
    userErrors,
  }),
});

export const updateDocument = `mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
  articleUpdate(id: $id, article: $article) {
    article { ${articleFields} }
    userErrors { code message }
  }
}`;
export const updateResultSchema = z.object({
  articleUpdate: z.object({ article: articleNode.nullable(), userErrors }),
});

export function seoMetafields(fields: {
  metaTitle: string;
  metaDescription: string;
}) {
  return [
    {
      namespace: "global",
      key: "title_tag",
      type: "single_line_text_field",
      value: fields.metaTitle,
    },
    {
      namespace: "global",
      key: "description_tag",
      type: "single_line_text_field",
      value: fields.metaDescription,
    },
  ];
}

export function throwUserErrors(errors: { message: string }[]): never {
  throw new ContentRefusal(
    `Shopify refused the request: ${errors
      .map((e) => e.message)
      .join("; ")
      .slice(0, 300)}`,
  );
}

export function articleUrl(
  shopDomain: string,
  blogHandle: string,
  articleHandle: string,
): string {
  return `https://${shopDomain}/blogs/${blogHandle}/${articleHandle}`;
}

type ArticleNode = z.infer<typeof articleNode>;

export function toDetail(
  shopDomain: string,
  node: ArticleNode,
): StoreArticleDetail {
  return {
    externalId: node.id,
    handle: node.handle,
    title: node.title,
    bodyHtml: node.body,
    metaTitle: node.titleTag?.value ?? "",
    metaDescription: node.descriptionTag?.value ?? "",
    isPublished: node.isPublished,
    blogId: node.blog.id,
    blogHandle: node.blog.handle,
    url: articleUrl(shopDomain, node.blog.handle, node.handle),
  };
}

export function toSummary(
  shopDomain: string,
  node: z.infer<typeof articleSummaryNode>,
): StoreArticleSummary {
  return {
    externalId: node.id,
    handle: node.handle,
    title: node.title,
    isPublished: node.isPublished,
    blogHandle: node.blog.handle,
    url: articleUrl(shopDomain, node.blog.handle, node.handle),
  };
}
