import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ContentRefusal } from "../rules/contentRefusal";
import { ShopifyOutcomeUnknown, createShopifyClient } from "./shopifyGraphql";
import type { Page } from "./shopifyGraphql";
import { readSent } from "./shopifyTestSupport";

const TOKEN = "shpat_secret_token_value";

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function clientWith(responses: (() => Response | Promise<Response>)[]) {
  const queue = [...responses];
  const fetchImpl = vi.fn((_url: unknown, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("fetch called more than scripted");
    return Promise.resolve(next());
  });
  const sleep = vi.fn(() => Promise.resolve());
  const client = createShopifyClient({
    shopDomain: "x.myshopify.com",
    accessToken: TOKEN,
    apiVersion: "2026-10",
    fetchImpl,
    sleep,
  });
  return { client, fetchImpl, sleep };
}

const throttled = (requested: number, available: number, rate: number) =>
  json({
    errors: [
      {
        message: "Throttled",
        extensions: {
          code: "THROTTLED",
          cost: {
            requestedQueryCost: requested,
            throttleStatus: {
              currentlyAvailable: available,
              restoreRate: rate,
            },
          },
        },
      },
    ],
  });

const itemsSchema = z.object({
  items: z.object({
    nodes: z.array(z.number()),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
  }),
});
const parse = (data: unknown): Page<number> => itemsSchema.parse(data).items;

describe("readAll", () => {
  it("follows cursors until the connection is exhausted", async () => {
    const { client, fetchImpl } = clientWith([
      () =>
        json({
          data: {
            items: {
              nodes: [1, 2],
              pageInfo: { hasNextPage: true, endCursor: "c1" },
            },
          },
        }),
      () =>
        json({
          data: {
            items: {
              nodes: [3],
              pageInfo: { hasNextPage: false, endCursor: "c2" },
            },
          },
        }),
    ]);
    const result = await client.readAll("query", parse);
    expect(result).toEqual({ nodes: [1, 2, 3], truncated: false });
    const sent = fetchImpl.mock.calls.map(
      (call) => readSent(call[1]).variables,
    );
    expect(sent).toEqual([{ after: null }, { after: "c1" }]);
  });

  it("stops and flags a cursor that does not advance", async () => {
    const stuck = () =>
      json({
        data: {
          items: {
            nodes: [1],
            pageInfo: { hasNextPage: true, endCursor: "same" },
          },
        },
      });
    const { client, fetchImpl } = clientWith([stuck, stuck, stuck]);
    const result = await client.readAll("query", parse);
    expect(result.truncated).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("flags a list cut off by the page cap", async () => {
    let n = 0;
    const page = () =>
      json({
        data: {
          items: {
            nodes: [n],
            pageInfo: { hasNextPage: true, endCursor: `c${++n}` },
          },
        },
      });
    const { client } = clientWith([page, page, page]);
    const result = await client.readAll("query", parse, { maxPages: 3 });
    expect(result).toEqual({ nodes: [0, 1, 2], truncated: true });
  });
});

describe("throttling", () => {
  it("waits for the cost bucket to refill, then retries", async () => {
    const { client, sleep, fetchImpl } = clientWith([
      () => throttled(500, 100, 50),
      () => json({ data: { ok: true } }),
    ]);
    expect(await client.query("query")).toEqual({ ok: true });
    // (500 - 100) / 50 per second = 8 seconds.
    expect(sleep).toHaveBeenCalledWith(8000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After on HTTP 429, including for writes", async () => {
    const { client, sleep } = clientWith([
      () => new Response("", { status: 429, headers: { "retry-after": "2" } }),
      () => json({ data: { ok: true } }),
    ]);
    await client.query("mutation", {}, "write");
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("gives up after a bounded number of retries", async () => {
    const always = () => throttled(100, 0, 100);
    const { client, fetchImpl } = clientWith([
      always,
      always,
      always,
      always,
      always,
    ]);
    await expect(client.query("query")).rejects.toBeInstanceOf(ContentRefusal);
    // The first attempt plus four retries.
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("does not sleep longer than the per-wait cap", async () => {
    const { client, sleep } = clientWith([() => throttled(10_000, 0, 1)]);
    await expect(client.query("query")).rejects.toThrow("rate limiting");
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("failures", () => {
  it("retries a read on 503 but never a write, whose outcome is unknown", async () => {
    const read = clientWith([
      () => new Response("", { status: 503 }),
      () => json({ data: { ok: true } }),
    ]);
    expect(await read.client.query("query")).toEqual({ ok: true });

    const write = clientWith([() => new Response("", { status: 503 })]);
    await expect(
      write.client.query("mutation", {}, "write"),
    ).rejects.toBeInstanceOf(ShopifyOutcomeUnknown);
    expect(write.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never puts the access token in an error", async () => {
    const responses = [
      () => new Response("", { status: 401 }),
      () => json({ errors: [{ message: "Access denied" }] }),
      () => new Response("", { status: 500 }),
    ];
    for (const response of responses) {
      const { client } = clientWith([response]);
      const error = await client.query("query", {}, "write").then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(TOKEN);
    }
  });

  it("sends the token only in the Shopify header", async () => {
    const { client, fetchImpl } = clientWith([() => json({ data: {} })]);
    await client.query("query { shop { name } }", { a: 1 });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.stringify(init?.body)).not.toContain(TOKEN);
    expect(JSON.stringify(init?.headers)).toContain(TOKEN);
  });
});
