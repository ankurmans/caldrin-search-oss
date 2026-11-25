import { ContentRefusal } from "../rules/contentRefusal";
import {
  SHOPIFY_OAUTH_SCOPES,
  buildAuthorizeUrl,
  exchangeCode,
  normalizeShopDomain,
  verifyCallbackHmac,
} from "../shopify/shopifyOAuth";
import { signOAuthState, verifyOAuthState } from "../shopify/shopifyOAuthState";
import {
  connectShopifyOAuth,
  getShopifyAppCredentials,
} from "./shopifyConnection";

// Connecting a store through Shopify's authorization code grant. The callback
// route is one GET; everything it decides lives here.

export const SHOPIFY_CALLBACK_PATH = "/api/shopify/callback";

export async function isShopifyOAuthConfigured(): Promise<boolean> {
  return (await getShopifyAppCredentials()) !== null;
}

// UNVERIFIED LIVE: the authorize and token calls follow Shopify's documented
// flow but have only run against fakes.
export async function startShopifyOAuth(
  scope: { projectId: string; userId: string },
  input: { shop: string; publicOrigin: string },
): Promise<{ authorizeUrl: string }> {
  const credentials = await getShopifyAppCredentials();
  if (!credentials) {
    throw new ContentRefusal(
      "Shopify app credentials are not configured on this deployment.",
    );
  }
  const shopDomain = normalizeShopDomain(input.shop);
  const state = await signOAuthState(
    { projectId: scope.projectId, userId: scope.userId, shopDomain },
    credentials.clientSecret,
  );
  return {
    authorizeUrl: buildAuthorizeUrl({
      shopDomain,
      clientId: credentials.clientId,
      redirectUri: `${input.publicOrigin}${SHOPIFY_CALLBACK_PATH}`,
      scopes: SHOPIFY_OAUTH_SCOPES,
      state,
    }),
  };
}

const AUTH_ERROR = (code: string) => `/auth-error?error=${code}`;

// Returns where to send the browser. A callback that cannot be trusted (bad
// HMAC, bad or expired state, a different signed-in person) goes to the error
// page without touching anything. Once the state is trusted, problems go back
// to the content page, which shows them.
export async function completeShopifyOAuth(input: {
  params: URLSearchParams;
  user: { userId: string; organizationId: string };
  // Throws unless this person may manage integrations on that project.
  authorizeProject: (projectId: string) => Promise<void>;
}): Promise<string> {
  const credentials = await getShopifyAppCredentials();
  if (!credentials) return AUTH_ERROR("shopify_not_configured");
  const { params, user } = input;
  if (!(await verifyCallbackHmac(params, credentials.clientSecret))) {
    return AUTH_ERROR("state_mismatch");
  }
  const state = await verifyOAuthState(
    params.get("state"),
    credentials.clientSecret,
  );
  if (!state || state.userId !== user.userId) {
    return AUTH_ERROR("state_mismatch");
  }
  await input.authorizeProject(state.projectId);

  const back = `/p/${state.projectId}/content`;
  const fail = (code: string) => `${back}?shopify_error=${code}`;
  let shopDomain: string;
  try {
    shopDomain = normalizeShopDomain(params.get("shop") ?? "");
  } catch {
    return fail("shop_mismatch");
  }
  if (shopDomain !== state.shopDomain) return fail("shop_mismatch");
  const code = params.get("code");
  if (!code) return fail("missing_code");

  let tokens;
  try {
    tokens = await exchangeCode({ shopDomain, ...credentials, code });
  } catch {
    return fail("token_exchange_failed");
  }
  await connectShopifyOAuth(
    {
      projectId: state.projectId,
      organizationId: user.organizationId,
      userId: user.userId,
    },
    { shopDomain, tokens },
  );
  return back;
}
