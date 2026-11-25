import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRepository } from "../repositories/ContentRepository";
import { resetDatabase } from "./contentTestDb";
import { connectLive, scope } from "./shopifyChangeTestSupport";
import { handleShopifyWebhook } from "./shopifyWebhooks";

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

const SECRET = "app-secret";
const BODY = '{"shop_domain":"live-shop.myshopify.com"}';

async function sign(body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

async function connectedShop() {
  await connectLive(["read_content", "write_content"]);
  return (
    (await ContentRepository.getConnection(scope.projectId))?.shopDomain ?? null
  );
}

beforeEach(() => {
  resetDatabase();
  vi.stubEnv("SHOPIFY_CLIENT_ID", "app-id");
  vi.stubEnv("SHOPIFY_CLIENT_SECRET", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("shopify webhooks", () => {
  it("drops the stored tokens when the app is uninstalled", async () => {
    const shopDomain = await connectedShop();
    const result = await handleShopifyWebhook({
      rawBody: BODY,
      hmac: await sign(BODY),
      topic: "app/uninstalled",
      shopDomain,
    });
    expect(result.status).toBe(200);
    expect(await ContentRepository.getConnection(scope.projectId)).toBeNull();
  });

  it("ignores a request whose signature does not match", async () => {
    const shopDomain = await connectedShop();
    const result = await handleShopifyWebhook({
      rawBody: BODY,
      hmac: await sign("another body"),
      topic: "app/uninstalled",
      shopDomain,
    });
    expect(result.status).toBe(401);
    expect(
      await ContentRepository.getConnection(scope.projectId),
    ).not.toBeNull();
  });
});
