import { z } from "zod";
import { constantTimeEqual, hmacHex } from "./shopifyOAuth";

// The `state` sent to Shopify and read back on the callback. It is stateless:
// a signed payload binding the project, the person who started the connect and
// the shop, with an expiry. The signing key is a server secret, so it cannot
// be forged or edited. Domain-separated from Shopify's own callback HMAC,
// which uses the same app secret over different text.

const STATE_TTL_MS = 10 * 60_000;
const DOMAIN = "caldrin-shopify-oauth-state\n";

const claimsSchema = z.object({
  p: z.string(),
  u: z.string(),
  s: z.string(),
  e: z.number(),
});

type StateClaims = { projectId: string; userId: string; shopDomain: string };

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (c) => c.charCodeAt(0)),
  );
}

export async function signOAuthState(
  claims: StateClaims,
  secret: string,
  now: number = Date.now(),
): Promise<string> {
  const body = toBase64Url(
    JSON.stringify({
      p: claims.projectId,
      u: claims.userId,
      s: claims.shopDomain,
      e: now + STATE_TTL_MS,
      n: crypto.randomUUID(),
    }),
  );
  return `${body}.${await hmacHex(secret, DOMAIN + body)}`;
}

// null for anything that is not a state this server signed and that has not
// expired.
export async function verifyOAuthState(
  state: string | null,
  secret: string,
  now: number = Date.now(),
): Promise<StateClaims | null> {
  const [body, signature, extra] = (state ?? "").split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!constantTimeEqual(await hmacHex(secret, DOMAIN + body), signature)) {
    return null;
  }
  try {
    const parsed = claimsSchema.safeParse(JSON.parse(fromBase64Url(body)));
    if (!parsed.success || parsed.data.e < now) return null;
    const { p, u, s } = parsed.data;
    return { projectId: p, userId: u, shopDomain: s };
  } catch {
    return null;
  }
}
