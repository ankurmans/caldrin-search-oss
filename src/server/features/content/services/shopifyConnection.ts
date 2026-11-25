import { runAfterResponse } from "@/server/lib/background";
import { captureServerEvent } from "@/server/lib/posthog";
import { ContentRefusal } from "../rules/contentRefusal";
import { openSecret, sealSecret } from "@/server/lib/secret-box";
import { ContentRepository } from "../repositories/ContentRepository";
import type { ShopifyConnection } from "../repositories/ShopifyConnectionRepository";
import type { ShopifyStorePort } from "../shopify/ShopifyStorePort";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { needsRefresh, refreshTokens } from "../shopify/shopifyOAuth";
import type { OAuthTokens } from "../shopify/shopifyOAuth";
import {
  SHOPIFY_ADAPTER_VERIFIED,
  SHOPIFY_API_VERSION,
  connectLiveShop,
  isDevelopmentShop,
  createLiveShop,
  normalizeShopDomain,
} from "../shopify/liveShopify";
import {
  SIMULATED_SHOP_DOMAIN,
  createSimulatedShop,
} from "../shopify/simulatedShop";

// The Shopify app this deployment connects stores with. null when the
// deployment has no app credentials, which turns the connect button off.
export async function getShopifyAppCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  const clientId = await getOptionalEnvValue("SHOPIFY_CLIENT_ID");
  const clientSecret = await getOptionalEnvValue("SHOPIFY_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export type Scope = {
  projectId: string;
  organizationId: string;
  userId: string;
};

// Public Shopify apps hold a 1 hour access token plus a 90 day refresh token.
// Refresh when close to expiry and store the rotated pair together. Not yet
// serialized per shop: two concurrent refreshes would invalidate each other,
// so a lock is needed before heavy parallel use (see handoff notes).
// Shopify's refresh token is single use, so two refreshes at once would burn
// it and leave the store needing a reconnect. Calls in this Worker share one
// refresh per project, and each re-reads the stored token first because
// another request may have refreshed it already.
const refreshing = new Map<string, Promise<string>>();

async function readAccessToken(
  connection: ShopifyConnection,
): Promise<string | null> {
  return connection.sealedAccessToken
    ? openSecret(connection.sealedAccessToken)
    : null;
}

async function refreshAccessToken(
  connection: ShopifyConnection,
): Promise<string> {
  const latest =
    (await ContentRepository.getConnection(connection.projectId)) ?? connection;
  const current = await readAccessToken(latest);
  if (current && !needsRefresh(latest.accessTokenExpiresAt)) return current;
  const sealedRefresh = latest.sealedRefreshToken;
  const refreshToken = sealedRefresh ? await openSecret(sealedRefresh) : null;
  const credentials = await getShopifyAppCredentials();
  if (!refreshToken || !credentials) {
    throw new ContentRefusal(
      "The Shopify access token expired and cannot be refreshed. Reconnect the store.",
    );
  }
  let next;
  try {
    next = await refreshTokens({
      shopDomain: latest.shopDomain,
      ...credentials,
      refreshToken,
    });
  } catch (error) {
    // Another Worker may have used the single-use refresh token a moment ago
    // and stored the new pair. Use that one if it is there.
    const again = await ContentRepository.getConnection(latest.projectId);
    const token = again && (await readAccessToken(again));
    if (again && token && !needsRefresh(again.accessTokenExpiresAt)) {
      return token;
    }
    throw error;
  }
  await ContentRepository.updateTokens(latest.projectId, {
    sealedAccessToken: await sealSecret(next.accessToken),
    sealedRefreshToken: next.refreshToken
      ? await sealSecret(next.refreshToken)
      : null,
    accessTokenExpiresAt: next.accessTokenExpiresAt,
    refreshTokenExpiresAt: next.refreshTokenExpiresAt,
  });
  return next.accessToken;
}

async function usableAccessToken(
  connection: ShopifyConnection,
): Promise<string> {
  const token = await readAccessToken(connection);
  if (!token) {
    throw new ContentRefusal(
      "The stored Shopify token can no longer be read. Reconnect the store.",
    );
  }
  if (!needsRefresh(connection.accessTokenExpiresAt)) return token;
  const pending = refreshing.get(connection.projectId);
  if (pending) return pending;
  const started = refreshAccessToken(connection).finally(() =>
    refreshing.delete(connection.projectId),
  );
  refreshing.set(connection.projectId, started);
  return started;
}

export async function storeFor(
  connection: ShopifyConnection,
): Promise<ShopifyStorePort> {
  if (connection.mode === "simulated") {
    return createSimulatedShop(connection.shopDomain);
  }
  const token = await usableAccessToken(connection);
  return createLiveShop({
    shopDomain: connection.shopDomain,
    accessToken: token,
    apiVersion: connection.apiVersion,
  });
}

// Always re-reads the connection, so a store that was disconnected a moment ago
// is refused even if a caller still holds its old connection object.
export async function storeForProject(
  projectId: string,
): Promise<ShopifyStorePort> {
  return storeFor(await requireConnection(projectId));
}

export async function requireConnection(
  projectId: string,
): Promise<ShopifyConnection> {
  const connection = await ContentRepository.getConnection(projectId);
  if (!connection) {
    throw new ContentRefusal("Connect a Shopify store first.");
  }
  return connection;
}

// Auto-publish may be on only for a real store that has already had an article
// go live through the normal approval steps.
async function autoPublishAllowed(c: ShopifyConnection): Promise<boolean> {
  if (c.mode !== "live" || !c.canPublish) return false;
  const published = await ContentRepository.listPublishedArticles(c.projectId);
  return published.some((article) => article.mode === "live");
}

export async function setAutoPublish(projectId: string, enabled: boolean) {
  const c = await requireConnection(projectId);
  if (enabled && !(await autoPublishAllowed(c))) {
    throw new ContentRefusal(
      "Publish one article through the approval steps first. Auto-publish is for a connected store that has already published cleanly.",
    );
  }
  await ContentRepository.setAutoPublish(projectId, enabled);
}

export async function getConnectionSummary(projectId: string) {
  const c = await ContentRepository.getConnection(projectId);
  if (!c) return null;
  return {
    shopDomain: c.shopDomain,
    mode: c.mode,
    isDevelopmentStore: c.isDevelopmentStore,
    canPublish: c.canPublish,
    blogId: c.blogId,
    autoPublish: c.autoPublish,
    autoPublishAllowed: await autoPublishAllowed(c),
    grantedScopes: c.grantedScopes,
    apiVersion: c.apiVersion,
    // "mock": the Shopify adapter has only been exercised against fakes. Never
    // contains a token; the sealed columns are not selected into this object.
    adapterVerified: SHOPIFY_ADAPTER_VERIFIED,
  };
}

// A live connection is replaced only by the same store (a fresh token). Moving
// a project to another store, or to the simulated one, means disconnecting
// first, so a click never silently drops the store drafts were published to.
async function refuseToReplaceLiveStore(
  projectId: string,
  next: { shopDomain: string; mode: "live" | "simulated" },
) {
  const existing = await ContentRepository.getConnection(projectId);
  if (
    existing?.mode === "live" &&
    (next.mode !== "live" || existing.shopDomain !== next.shopDomain)
  ) {
    throw new ContentRefusal(
      `This project is connected to ${existing.shopDomain}. Disconnect it before connecting something else.`,
    );
  }
}

// A merchant's own store connects with a custom-app Admin API token. The token
// is validated against Shopify, its scopes are read back, and it is stored
// sealed. Publishing is only enabled when write_content was actually granted.
export async function connectShopify(
  scope: Scope,
  input: { shopDomain: string; accessToken: string },
) {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  await refuseToReplaceLiveStore(scope.projectId, {
    shopDomain,
    mode: "live",
  });
  const verified = await connectLiveShop({
    shopDomain,
    accessToken: input.accessToken,
    apiVersion: SHOPIFY_API_VERSION,
  });
  await ContentRepository.upsertConnection({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    shopDomain,
    mode: "live",
    isDevelopmentStore: await isDevelopmentShop({
      shopDomain,
      accessToken: input.accessToken,
      apiVersion: SHOPIFY_API_VERSION,
    }),
    sealedAccessToken: await sealSecret(input.accessToken),
    grantedScopes: verified.scopes.join(","),
    canPublish: verified.scopes.includes("write_content"),
    apiVersion: SHOPIFY_API_VERSION,
    connectedByUserId: scope.userId,
  });
  await runAfterResponse(
    captureServerEvent({
      distinctId: scope.userId,
      organizationId: scope.organizationId,
      event: "onboarding:connector_installed",
      properties: { project_id: scope.projectId, platform: "shopify" },
    }),
  );
  return getConnectionSummary(scope.projectId);
}

// A store connected through the OAuth flow. The scopes are the ones Shopify
// says it granted in the token answer, and publishing is only enabled when
// write_content is among them.
export async function connectShopifyOAuth(
  scope: Scope,
  input: { shopDomain: string; tokens: OAuthTokens },
) {
  const { tokens } = input;
  await refuseToReplaceLiveStore(scope.projectId, {
    shopDomain: input.shopDomain,
    mode: "live",
  });
  await ContentRepository.upsertConnection({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    shopDomain: input.shopDomain,
    mode: "live",
    isDevelopmentStore: await isDevelopmentShop({
      shopDomain: input.shopDomain,
      accessToken: tokens.accessToken,
      apiVersion: SHOPIFY_API_VERSION,
    }),
    sealedAccessToken: await sealSecret(tokens.accessToken),
    sealedRefreshToken: tokens.refreshToken
      ? await sealSecret(tokens.refreshToken)
      : null,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    grantedScopes: tokens.scopes.join(","),
    canPublish: tokens.scopes.includes("write_content"),
    apiVersion: SHOPIFY_API_VERSION,
    connectedByUserId: scope.userId,
  });
  await runAfterResponse(
    captureServerEvent({
      distinctId: scope.userId,
      organizationId: scope.organizationId,
      event: "onboarding:connector_installed",
      properties: { project_id: scope.projectId, platform: "shopify" },
    }),
  );
  return getConnectionSummary(scope.projectId);
}

// `shopDomain` is the label of the simulated store; tests pass their own so
// simulated stores do not share state.
export async function connectSimulatedShop(
  scope: Scope,
  shopDomain: string = SIMULATED_SHOP_DOMAIN,
) {
  await refuseToReplaceLiveStore(scope.projectId, {
    shopDomain,
    mode: "simulated",
  });
  await ContentRepository.upsertConnection({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    shopDomain,
    mode: "simulated",
    sealedAccessToken: null,
    grantedScopes: "read_products,read_content,write_content",
    canPublish: true,
    apiVersion: SHOPIFY_API_VERSION,
    connectedByUserId: scope.userId,
  });
  return getConnectionSummary(scope.projectId);
}

export type DisconnectResult = { revoked: boolean; note: string };

// Tokens issued by the OAuth flow are this app's own, so disconnecting asks
// Shopify to revoke them. A token the merchant pasted from their own custom
// app is not revoked here: that would uninstall an app they made and may use
// for other things. UNVERIFIED LIVE: revocation has only run against fakes.
function wasIssuedByOAuth(connection: ShopifyConnection): boolean {
  return Boolean(
    connection.sealedRefreshToken || connection.accessTokenExpiresAt,
  );
}

// Always deletes the connection row, which holds the sealed access token and
// the sealed refresh token (nothing else keeps a token: stores are built per
// call and never cached), whether or not Shopify confirmed the revocation.
export async function disconnectShopify(
  projectId: string,
): Promise<DisconnectResult> {
  const connection = await ContentRepository.getConnection(projectId);
  if (!connection) return { revoked: true, note: "No store was connected." };
  let result: DisconnectResult;
  try {
    if (connection.mode === "simulated" || wasIssuedByOAuth(connection)) {
      result = await (await storeFor(connection)).revokeAccess();
    } else {
      result = {
        revoked: false,
        note: "Disconnected here. This store was connected with a pasted token, which this app does not revoke: delete the token or remove the custom app in the Shopify admin.",
      };
    }
  } catch {
    // An unreadable or expired token cannot be sent to Shopify.
    result = {
      revoked: false,
      note: "Disconnected here. Revoking the token at Shopify was not confirmed: remove the app in the Shopify admin.",
    };
  } finally {
    await ContentRepository.deleteConnection(projectId);
  }
  return result;
}
