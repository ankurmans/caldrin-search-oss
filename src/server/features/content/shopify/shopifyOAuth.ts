import { z } from "zod";
import { ContentRefusal } from "../rules/contentRefusal";

// Shopify's authorization code grant for a public or Dev Dashboard app. The
// pure pieces (shop validation, authorize URL, callback HMAC) are separate from
// the two network calls so they can be tested without Shopify.

const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShopDomain(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!SHOP_PATTERN.test(cleaned)) {
    throw new ContentRefusal(
      "Enter the store's .myshopify.com address, for example example.myshopify.com.",
    );
  }
  return cleaned;
}

// What the connect flow asks for. write_content is what lets a person approve
// a change that reaches the store; each write still needs its own approval.
export const SHOPIFY_OAUTH_SCOPES = [
  "read_products",
  "read_content",
  "write_content",
];

export function buildAuthorizeUrl(input: {
  shopDomain: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
}): string {
  const url = new URL(`https://${input.shopDomain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", input.scopes.join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacHex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
}

// Webhooks sign the raw body and send the digest as base64, not hex.
export async function verifyWebhookHmac(
  rawBody: string,
  provided: string | null,
  clientSecret: string,
): Promise<boolean> {
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return constantTimeEqual(expected, provided);
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Per Shopify: drop `hmac`, sort the rest alphabetically, join as key=value
// with &, HMAC-SHA256 with the app secret, compare in constant time.
export async function verifyCallbackHmac(
  params: URLSearchParams,
  clientSecret: string,
): Promise<boolean> {
  const provided = params.get("hmac");
  if (!provided) return false;
  const pairs = [...params.entries()].filter(([key]) => key !== "hmac");
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = pairs.map(([key, value]) => `${key}=${value}`).join("&");
  return constantTimeEqual(await hmacHex(clientSecret, message), provided);
}

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
};

const tokenResponseSchema = z.object({
  access_token: z.string().optional(),
  scope: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
});
type TokenResponse = z.infer<typeof tokenResponseSchema>;

function toTokens(body: TokenResponse, now: number): OAuthTokens {
  if (!body.access_token) {
    throw new ContentRefusal("Shopify did not return an access token.");
  }
  const at = (seconds?: number) =>
    seconds ? new Date(now + seconds * 1000).toISOString() : null;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    scopes: (body.scope ?? "").split(",").filter(Boolean),
    accessTokenExpiresAt: at(body.expires_in),
    refreshTokenExpiresAt: at(body.refresh_token_expires_in),
  };
}

async function postToken(
  shopDomain: string,
  form: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(
    `https://${shopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new ContentRefusal(
      response.status === 401
        ? "Shopify rejected the authorization. Reconnect the store."
        : `Shopify token request failed (${response.status}).`,
    );
  }
  const body: unknown = await response.json();
  return tokenResponseSchema.parse(body);
}

export async function exchangeCode(input: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  code: string;
  now?: number;
}): Promise<OAuthTokens> {
  const body = await postToken(input.shopDomain, {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    expiring: "1",
  });
  return toTokens(body, input.now ?? Date.now());
}

// Each refresh returns a NEW refresh token that replaces the old one; the
// caller stores both together and serializes refreshes per shop.
export async function refreshTokens(input: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  now?: number;
}): Promise<OAuthTokens> {
  const body = await postToken(input.shopDomain, {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  return toTokens(body, input.now ?? Date.now());
}

// Refresh a minute early so a request never carries an expired token.
export function needsRefresh(
  accessTokenExpiresAt: string | null,
  now: number = Date.now(),
): boolean {
  if (!accessTokenExpiresAt) return false;
  return Date.parse(accessTokenExpiresAt) - now < 60_000;
}
