import { sortBy } from "remeda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRepository } from "../repositories/ContentRepository";
import { hmacHex } from "../shopify/shopifyOAuth";
import { resetDatabase } from "./contentTestDb";
import { connectLive, connect, scope } from "./shopifyChangeTestSupport";
import { connectShopifyOAuth, disconnectShopify } from "./shopifyConnection";
import { completeShopifyOAuth, startShopifyOAuth } from "./shopifyOAuthFlow";

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
const SHOP = "oauth-shop.myshopify.com";
const ORIGIN = "https://app.example.com";
const user = { userId: scope.userId, organizationId: scope.organizationId };
const allow = () => Promise.resolve();

beforeEach(() => {
  resetDatabase();
  vi.stubEnv("SHOPIFY_CLIENT_ID", "app-id");
  vi.stubEnv("SHOPIFY_CLIENT_SECRET", SECRET);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function authorizeStateFor(shop = SHOP) {
  const { authorizeUrl } = await startShopifyOAuth(scope, {
    shop,
    publicOrigin: ORIGIN,
  });
  return new URL(authorizeUrl);
}

// What Shopify sends back: the same params, signed with the app secret.
async function callback(over: Record<string, string> = {}, state?: string) {
  const params = new URLSearchParams({
    shop: SHOP,
    code: "the-code",
    state: state ?? (await authorizeStateFor()).searchParams.get("state") ?? "",
    timestamp: "1700000000",
    ...over,
  });
  const message = sortBy([...params.entries()], ([key]) => key)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  params.set("hmac", await hmacHex(SECRET, message));
  return params;
}

const tokenAnswer = (body: object) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body)));

describe("starting the Shopify connect", () => {
  it("says so when the deployment has no app credentials", async () => {
    vi.stubEnv("SHOPIFY_CLIENT_ID", "");
    await expect(
      startShopifyOAuth(scope, { shop: SHOP, publicOrigin: ORIGIN }),
    ).rejects.toThrow("not configured on this deployment");
  });

  it("sends the person to the store's authorize page with the three scopes", async () => {
    const url = await authorizeStateFor("https://OAuth-Shop.myshopify.com/");
    expect(url.origin + url.pathname).toBe(
      `https://${SHOP}/admin/oauth/authorize`,
    );
    expect(url.searchParams.get("scope")).toBe(
      "read_products,read_content,write_content",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/shopify/callback`,
    );
  });
});

describe("the Shopify callback", () => {
  it("exchanges the code, stores the token sealed, and returns to the content page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            (url instanceof Request ? url.url : url.toString()).endsWith(
              "/admin/oauth/access_token",
            )
              ? {
                  access_token: "shpua_secret",
                  scope: "read_products,read_content,write_content",
                  expires_in: 3600,
                  refresh_token: "shprt_secret",
                }
              : { data: { shop: { plan: { partnerDevelopment: true } } } },
          ),
        ),
      ),
    );

    const location = await completeShopifyOAuth({
      params: await callback(),
      user,
      authorizeProject: allow,
    });

    expect(location).toBe(`/p/${scope.projectId}/content`);
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://${SHOP}/admin/oauth/access_token`,
      expect.anything(),
    );
    const connection = await ContentRepository.getConnection(scope.projectId);
    expect(connection).toMatchObject({
      shopDomain: SHOP,
      mode: "live",
      isDevelopmentStore: true,
      canPublish: true,
      sealedAccessToken: "sealed(shpua_secret)",
      sealedRefreshToken: "sealed(shprt_secret)",
    });
  });

  it("is read-only when Shopify did not grant write_content", async () => {
    tokenAnswer({ access_token: "t", scope: "read_products,read_content" });
    await completeShopifyOAuth({
      params: await callback(),
      user,
      authorizeProject: allow,
    });
    expect(
      (await ContentRepository.getConnection(scope.projectId))?.canPublish,
    ).toBe(false);
  });

  it("rejects a callback whose Shopify signature does not verify, before any network call", async () => {
    const fetchSpy = tokenAnswer({ access_token: "t" });
    const params = await callback();
    params.set("code", "swapped-code");

    const location = await completeShopifyOAuth({
      params,
      user,
      authorizeProject: allow,
    });

    expect(location).toBe("/auth-error?error=state_mismatch");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await ContentRepository.getConnection(scope.projectId)).toBeNull();
  });

  it("rejects a state that was edited, expired, or started by someone else", async () => {
    const fetchSpy = tokenAnswer({ access_token: "t" });
    const state = (await authorizeStateFor()).searchParams.get("state") ?? "";
    const forged = `${state.slice(0, -2)}aa`;
    const expected = "/auth-error?error=state_mismatch";
    const run = async (
      params: URLSearchParams,
      who: { userId: string; organizationId: string } = user,
    ) => completeShopifyOAuth({ params, user: who, authorizeProject: allow });

    expect(await run(await callback({}, forged))).toBe(expected);
    expect(
      await run(await callback({}, state), { ...user, userId: "someone-else" }),
    ).toBe(expected);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await run(await callback({}, state))).toBe(expected);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns to the content page with a reason when the shop is not the one that started", async () => {
    const fetchSpy = tokenAnswer({ access_token: "t" });
    const location = await completeShopifyOAuth({
      params: await callback({ shop: "other.myshopify.com" }),
      user,
      authorizeProject: allow,
    });
    expect(location).toBe(
      `/p/${scope.projectId}/content?shopify_error=shop_mismatch`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does nothing for a person who may not manage this project", async () => {
    const fetchSpy = tokenAnswer({ access_token: "t" });
    await expect(
      completeShopifyOAuth({
        params: await callback(),
        user,
        authorizeProject: () => Promise.reject(new Error("forbidden")),
      }),
    ).rejects.toThrow("forbidden");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("disconnecting", () => {
  const oauthTokens = {
    accessToken: "shpua_secret",
    refreshToken: "shprt_secret",
    scopes: ["write_content"],
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshTokenExpiresAt: null,
  };

  it("revokes at Shopify with the token, then deletes the stored token", async () => {
    await connectShopifyOAuth(scope, { shopDomain: SHOP, tokens: oauthTokens });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const result = await disconnectShopify(scope.projectId);

    expect(result.revoked).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://${SHOP}/admin/api_permissions/current.json`,
      expect.objectContaining({
        method: "DELETE",
        headers: { "X-Shopify-Access-Token": "shpua_secret" },
      }),
    );
    expect(await ContentRepository.getConnection(scope.projectId)).toBeNull();
  });

  it.each([
    [
      "Shopify refuses",
      () => Promise.resolve(new Response(null, { status: 500 })),
    ],
    ["the request fails", () => Promise.reject(new Error("network down"))],
  ])(
    "still deletes the token when %s, and says it was not confirmed",
    async (_, answer) => {
      await connectShopifyOAuth(scope, {
        shopDomain: SHOP,
        tokens: oauthTokens,
      });
      vi.spyOn(globalThis, "fetch").mockImplementation(answer);

      const result = await disconnectShopify(scope.projectId);

      expect(result.revoked).toBe(false);
      expect(result.note).toContain("not confirmed");
      expect(result.note).toContain("remove the app in the Shopify admin");
      expect(await ContentRepository.getConnection(scope.projectId)).toBeNull();
    },
  );

  it("does not uninstall a custom app whose token was pasted", async () => {
    const fetchSpy = await connectLive(["write_content"]);
    const result = await disconnectShopify(scope.projectId);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.revoked).toBe(false);
    expect(await ContentRepository.getConnection(scope.projectId)).toBeNull();
  });

  it("disconnects a demo store without any Shopify call", async () => {
    await connect();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await disconnectShopify(scope.projectId)).revoked).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
