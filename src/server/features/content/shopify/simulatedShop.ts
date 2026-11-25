import { ContentRefusal } from "../rules/contentRefusal";
import type { GscRow } from "../rules/opportunityRules";
import type { StoreSnapshot } from "../rules/storeTypes";
import type {
  ArticleFields,
  ArticleInput,
  CreatedArticle,
  ShopifyStorePort,
  StoreArticleDetail,
  StoreBlog,
} from "./ShopifyStorePort";

// SIMULATED. This is a fixture store and fixture Search Console rows used for
// local testing and demos. Nothing here touches Shopify or Google, and the UI
// labels every record derived from it as simulated.

export const SIMULATED_SHOP_DOMAIN = "demo-coffee-roasters.myshopify.com";

export const simulatedSnapshot: StoreSnapshot = {
  shopName: "Demo Coffee Roasters",
  products: [
    {
      handle: "ethiopia-light-roast",
      title: "Ethiopia Light Roast",
      description:
        "A light roast coffee with floral notes, roasted in small batches.",
      available: true,
      images: [],
      details: "",
    },
    {
      handle: "colombia-medium-roast",
      title: "Colombia Medium Roast",
      description: "A medium roast coffee with a caramel finish.",
      available: true,
      images: [],
      details: "",
    },
    {
      handle: "seasonal-blend",
      title: "Seasonal Light Blend",
      description: "A light roast blend, currently sold out.",
      available: false,
      images: [],
      details: "",
    },
  ],
  collections: [
    { handle: "light-roast-coffee", title: "Light Roast Coffee" },
    { handle: "coffee-grinders", title: "Coffee Grinders" },
  ],
  articles: [
    {
      handle: "pour-over-guide",
      title: "Pour Over Brew Guide",
      blogHandle: "news",
    },
  ],
};

export const simulatedGscRows: GscRow[] = [
  {
    query: "how to choose light roast coffee",
    page: `https://${SIMULATED_SHOP_DOMAIN}/products/ethiopia-light-roast`,
    clicks: 9,
    impressions: 860,
    ctr: 0.0105,
    position: 13.2,
  },
  {
    query: "light roast coffee beans",
    page: `https://${SIMULATED_SHOP_DOMAIN}/products/ethiopia-light-roast`,
    clicks: 31,
    impressions: 1900,
    ctr: 0.0163,
    position: 8.4,
  },
  {
    query: "pour over coffee ratio",
    page: `https://${SIMULATED_SHOP_DOMAIN}/blogs/news/pour-over-guide`,
    clicks: 22,
    impressions: 1450,
    ctr: 0.0152,
    position: 11.6,
  },
  {
    query: "demo coffee roasters",
    page: `https://${SIMULATED_SHOP_DOMAIN}/`,
    clicks: 120,
    impressions: 1500,
    ctr: 0.08,
    position: 1.2,
  },
  {
    query: "ethiopia coffee roast",
    page: `https://${SIMULATED_SHOP_DOMAIN}/products/ethiopia-light-roast`,
    clicks: 6,
    impressions: 420,
    ctr: 0.0143,
    position: 2.6,
  },
  {
    query: "burr grinder cleaning",
    page: `https://${SIMULATED_SHOP_DOMAIN}/collections/coffee-grinders`,
    clicks: 0,
    impressions: 30,
    ctr: 0,
    position: 31,
  },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const SIMULATED_BLOG: StoreBlog = {
  id: "gid://shopify/Blog/simulated-news",
  handle: "news",
  title: "News",
};

// An existing live-looking article so "update an existing article" can be
// tried without a store.
export const SIMULATED_SEED_ARTICLE_ID =
  "gid://shopify/Article/simulated-pour-over-guide";

type SimulatedState = {
  articles: Map<string, StoreArticleDetail>;
  idByKey: Map<string, string>;
};

function seedState(shopDomain: string): SimulatedState {
  const seed: StoreArticleDetail = {
    externalId: SIMULATED_SEED_ARTICLE_ID,
    handle: "pour-over-guide",
    title: "Pour Over Brew Guide",
    bodyHtml:
      "<p>Use 15 grams of coffee for 250 grams of water.</p><p>Pour in slow circles.</p>",
    metaTitle: "Pour Over Brew Guide",
    metaDescription: "How to brew pour over coffee at home.",
    isPublished: true,
    blogId: SIMULATED_BLOG.id,
    blogHandle: SIMULATED_BLOG.handle,
    url: `https://${shopDomain}/blogs/${SIMULATED_BLOG.handle}/pour-over-guide`,
  };
  return {
    articles: new Map([[seed.externalId, seed]]),
    idByKey: new Map(),
  };
}

// In memory and per worker isolate: simulated articles survive across requests
// only while the isolate lives. A rollback after a restart finds no article and
// says so, which is honest for a simulation.
const sharedStates = new Map<string, SimulatedState>();

function stateFor(shopDomain: string): SimulatedState {
  let state = sharedStates.get(shopDomain);
  if (!state) {
    state = seedState(shopDomain);
    sharedStates.set(shopDomain, state);
  }
  return state;
}

// Deterministic: the same idempotency key always yields the same article, which
// is what makes a retried publish a no-op in tests and in the simulation.
// Pass `state` to isolate a test from the shared per-domain state.
export function createSimulatedShop(
  shopDomain: string = SIMULATED_SHOP_DOMAIN,
  state: SimulatedState = stateFor(shopDomain),
): ShopifyStorePort {
  function mustFind(externalId: string): StoreArticleDetail {
    const found = state.articles.get(externalId);
    if (!found) {
      throw new ContentRefusal(
        "That simulated article no longer exists (simulation state resets when the worker restarts).",
      );
    }
    return found;
  }
  function setPublished(externalId: string, isPublished: boolean) {
    const found = mustFind(externalId);
    state.articles.set(externalId, { ...found, isPublished });
    return Promise.resolve({ url: found.url });
  }
  return {
    readSnapshot: () => Promise.resolve(simulatedSnapshot),
    readShopName: () => Promise.resolve(simulatedSnapshot.shopName),
    listBlogs: () => Promise.resolve([SIMULATED_BLOG]),
    listArticles: () =>
      Promise.resolve([...state.articles.values()].map(summaryOf)),
    getArticle: (externalId) =>
      Promise.resolve(state.articles.get(externalId) ?? null),
    createDraftArticle(input: ArticleInput, idempotencyKey: string) {
      const existingId = state.idByKey.get(idempotencyKey);
      const existing = existingId ? state.articles.get(existingId) : undefined;
      if (existing) {
        return Promise.resolve<CreatedArticle>({
          externalId: existing.externalId,
          handle: existing.handle,
          url: existing.url,
        });
      }
      const handle = slugify(input.title);
      const article: StoreArticleDetail = {
        externalId: `gid://shopify/Article/simulated-${slugify(idempotencyKey)}`,
        handle,
        title: input.title,
        bodyHtml: input.bodyHtml,
        metaTitle: input.metaTitle,
        metaDescription: input.metaDescription,
        isPublished: false,
        blogId: SIMULATED_BLOG.id,
        blogHandle: SIMULATED_BLOG.handle,
        url: `https://${shopDomain}/blogs/${SIMULATED_BLOG.handle}/${handle}`,
      };
      state.articles.set(article.externalId, article);
      state.idByKey.set(idempotencyKey, article.externalId);
      return Promise.resolve({
        externalId: article.externalId,
        handle,
        url: article.url,
      });
    },
    updateArticle(externalId: string, fields: ArticleFields) {
      const updated = { ...mustFind(externalId), ...fields };
      state.articles.set(externalId, updated);
      return Promise.resolve(updated);
    },
    publishArticle: (externalId: string) => setPublished(externalId, true),
    unpublishArticle: (externalId: string) => setPublished(externalId, false),
    revokeAccess: () =>
      Promise.resolve({
        revoked: true,
        note: "Demo store disconnected. It held no Shopify token.",
      }),
  };
}

function summaryOf(a: StoreArticleDetail) {
  return {
    externalId: a.externalId,
    handle: a.handle,
    title: a.title,
    blogHandle: a.blogHandle,
    isPublished: a.isPublished,
    url: a.url,
  };
}
