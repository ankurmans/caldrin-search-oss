import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ContentRefusal } from "../rules/contentRefusal";
import { createLiveShop } from "./liveShopify";
import { readSent } from "./shopifyTestSupport";
import type { Sent } from "./shopifyTestSupport";

// A scripted Shopify: answers by the first operation name in the document.
function fakeShop(
  answers: Record<string, (variables: Sent["variables"]) => unknown>,
) {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => {
    const body = readSent(init);
    sent.push(body);
    const name = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? "Anon";
    const answer = answers[name];
    if (!answer) throw new Error(`Unscripted operation ${name}`);
    return Promise.resolve(
      new Response(JSON.stringify({ data: answer(body.variables) }), {
        status: 200,
      }),
    );
  });
  const shop = createLiveShop({
    shopDomain: "demo.myshopify.com",
    accessToken: "token",
    apiVersion: "2026-10",
    fetchImpl,
    sleep: () => Promise.resolve(),
  });
  return { shop, sent };
}

const articleNode = (over: Record<string, unknown> = {}) => ({
  id: "gid://shopify/Article/1",
  handle: "pour-over",
  title: "Pour over",
  body: "<p>Old</p>",
  isPublished: true,
  blog: { id: "gid://shopify/Blog/9", handle: "news" },
  titleTag: { value: "Old SEO title" },
  descriptionTag: null,
  ...over,
});

const noMore = { hasNextPage: false, endCursor: null };

describe("read sync", () => {
  it("pages through every product and reads nothing but SEO data", async () => {
    const { shop, sent } = fakeShop({
      Anon: () => ({ shop: { name: "Demo" } }),
      Products: (v) =>
        v.after === null
          ? {
              products: {
                nodes: [
                  {
                    handle: "a",
                    title: "A",
                    descriptionHtml: "<p>Light <b>roast</b></p>",
                    totalInventory: 3,
                    status: "ACTIVE",
                    images: {
                      nodes: [
                        { url: "https://cdn.shopify.com/a.jpg", altText: null },
                      ],
                    },
                    options: [{ name: "Color", values: ["Blue", "Red"] }],
                    metafields: {
                      nodes: [
                        {
                          key: "specs",
                          type: "rich_text_field",
                          value: JSON.stringify({
                            type: "root",
                            children: [
                              {
                                type: "list",
                                children: [
                                  {
                                    type: "list-item",
                                    children: [
                                      {
                                        type: "text",
                                        value: "For kids: 3-8 years old",
                                      },
                                    ],
                                  },
                                  {
                                    type: "list-item",
                                    children: [
                                      {
                                        type: "text",
                                        value: "Max load: 66 lb",
                                      },
                                    ],
                                  },
                                ],
                              },
                            ],
                          }),
                        },
                        { key: "rating", type: "number_integer", value: "5" },
                      ],
                    },
                  },
                ],
                pageInfo: { hasNextPage: true, endCursor: "p1" },
              },
            }
          : {
              products: {
                nodes: [
                  {
                    handle: "b",
                    title: "B",
                    descriptionHtml: "",
                    totalInventory: 0,
                    status: "ACTIVE",
                    images: { nodes: [] },
                    options: [{ name: "Title", values: ["Default Title"] }],
                    metafields: { nodes: [] },
                  },
                ],
                pageInfo: noMore,
              },
            },
      Collections: () => ({
        collections: { nodes: [{ handle: "c", title: "C" }], pageInfo: noMore },
      }),
      Articles: () => ({
        articles: {
          nodes: [
            {
              id: "gid://shopify/Article/1",
              handle: "pour-over",
              title: "Pour over",
              isPublished: true,
              blog: { handle: "news" },
            },
          ],
          pageInfo: noMore,
        },
      }),
    });
    const snapshot = await shop.readSnapshot();
    expect(snapshot.products).toEqual([
      {
        handle: "a",
        title: "A",
        description: "Light roast",
        available: true,
        images: [{ url: "https://cdn.shopify.com/a.jpg", alt: "" }],
        details:
          "specs:\nFor kids: 3-8 years old\nMax load: 66 lb\nColor: Blue, Red",
      },
      {
        handle: "b",
        title: "B",
        description: "",
        available: false,
        images: [],
        details: "",
      },
    ]);
    expect(snapshot.articles).toEqual([
      { handle: "pour-over", title: "Pour over", blogHandle: "news" },
    ]);
    expect(snapshot.truncated).toEqual([]);
    const everything = sent.map((s) => s.query).join("\n");
    expect(everything).not.toMatch(/\b(orders|customers|draftOrders)\b/);
  });
});

describe("articles", () => {
  it("reads an article with its SEO metafields, and null when it is gone", async () => {
    const { shop } = fakeShop({
      Article: (v) => ({
        article: v.id === "gid://shopify/Article/1" ? articleNode() : null,
      }),
    });
    expect(await shop.getArticle("gid://shopify/Article/1")).toMatchObject({
      externalId: "gid://shopify/Article/1",
      bodyHtml: "<p>Old</p>",
      metaTitle: "Old SEO title",
      metaDescription: "",
      isPublished: true,
      blogId: "gid://shopify/Blog/9",
      url: "https://demo.myshopify.com/blogs/news/pour-over",
    });
    expect(await shop.getArticle("gid://shopify/Article/2")).toBeNull();
  });

  it("updates text and SEO metafields without touching the published flag", async () => {
    const { shop, sent } = fakeShop({
      UpdateArticle: () => ({
        articleUpdate: {
          article: articleNode({ title: "New", body: "<p>New</p>" }),
          userErrors: [],
        },
      }),
    });
    const updated = await shop.updateArticle("gid://shopify/Article/1", {
      title: "New",
      bodyHtml: "<p>New</p>",
      metaTitle: "T",
      metaDescription: "D",
    });
    expect(updated.title).toBe("New");
    const { article } = z
      .object({ article: z.record(z.string(), z.unknown()) })
      .parse(sent[0]?.variables);
    expect(article).toMatchObject({ title: "New", body: "<p>New</p>" });
    expect(article).not.toHaveProperty("isPublished");
    expect(article.metafields).toEqual([
      expect.objectContaining({ key: "title_tag", value: "T" }),
      expect.objectContaining({ key: "description_tag", value: "D" }),
    ]);
  });

  it("unpublishes by setting only isPublished=false", async () => {
    const { shop, sent } = fakeShop({
      UpdateArticle: () => ({
        articleUpdate: {
          article: articleNode({ isPublished: false }),
          userErrors: [],
        },
      }),
    });
    await shop.unpublishArticle("gid://shopify/Article/1");
    expect(sent[0]?.variables).toEqual({
      id: "gid://shopify/Article/1",
      article: { isPublished: false },
    });
  });

  it("does not report success when Shopify says the article is still public", async () => {
    const { shop } = fakeShop({
      UpdateArticle: () => ({
        articleUpdate: {
          article: articleNode({ isPublished: true }),
          userErrors: [],
        },
      }),
    });
    await expect(
      shop.unpublishArticle("gid://shopify/Article/1"),
    ).rejects.toThrow("did not unpublish");
  });

  it("turns Shopify user errors into a refusal", async () => {
    const { shop } = fakeShop({
      UpdateArticle: () => ({
        articleUpdate: {
          article: null,
          userErrors: [{ code: "INVALID", message: "Title is too long" }],
        },
      }),
    });
    await expect(
      shop.updateArticle("gid://shopify/Article/1", {
        title: "x",
        bodyHtml: "x",
        metaTitle: "x",
        metaDescription: "x",
      }),
    ).rejects.toThrow(ContentRefusal);
  });

  it("creates into the chosen blog, unpublished", async () => {
    const { shop, sent } = fakeShop({
      Blogs: () => ({
        blogs: {
          nodes: [
            { id: "gid://shopify/Blog/1", handle: "news", title: "News" },
            { id: "gid://shopify/Blog/2", handle: "guides", title: "Guides" },
          ],
          pageInfo: noMore,
        },
      }),
      CreateDraft: () => ({
        articleCreate: {
          article: {
            id: "gid://shopify/Article/5",
            handle: "x",
            isPublished: false,
          },
          userErrors: [],
        },
      }),
    });
    const created = await shop.createDraftArticle(
      {
        authorName: "Demo",
        title: "X",
        bodyHtml: "<p>x</p>",
        metaTitle: "m",
        metaDescription: "d",
        blogId: "gid://shopify/Blog/2",
      },
      "key",
    );
    expect(created.url).toBe("https://demo.myshopify.com/blogs/guides/x");
    const create = sent.find((s) => s.query.includes("CreateDraft"));
    expect(create?.variables).toMatchObject({
      article: { blogId: "gid://shopify/Blog/2", isPublished: false },
    });
  });
});
