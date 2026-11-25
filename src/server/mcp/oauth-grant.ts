import { waitUntil } from "cloudflare:workers";
import type {
  AuthRequest,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { getBaseUrl } from "@/lib/auth";
import { OAUTH_AUTHORIZE_PATH } from "@/lib/auth-redirect";
import { MCP_OAUTH_SCOPES, MCP_SCOPE } from "@/lib/oauth-resource";
import { asAppError } from "@/server/lib/errors";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { resolveSessionContext } from "@/middleware/ensure-user/session";
import {
  completeOnboardingFromAgent,
  recordMcpAuthorized,
} from "@/server/features/activation/mcpActivation";
import { captureServerEvent } from "@/server/lib/posthog";
import { createWorkersOAuthMcpProps } from "@/server/mcp/context";

/**
 * Issues the MCP grant for an approved authorize request and returns the
 * client redirect.
 */
export async function completeMcpGrant(input: {
  oauth: OAuthHelpers;
  authRequest: AuthRequest;
  scopes: string[];
  context: { userId: string; userEmail: string; organizationId: string };
}) {
  const { oauth, authRequest, scopes, context } = input;
  // The grant is bound to the organization active at consent: every /mcp
  // request re-checks the user's membership in exactly this org and 401s once
  // it is gone (transport.ts). The same id goes into the grant metadata below,
  // which the Settings "Connected agents" list reads to name the workspace.
  const props = createWorkersOAuthMcpProps({
    userId: context.userId,
    userEmail: context.userEmail,
    organizationId: context.organizationId,
    baseUrl: getBaseUrl(),
    clientId: authRequest.clientId,
    scopes,
  });

  const { redirectTo } = await oauth.completeAuthorization({
    request: authRequest,
    userId: context.userId,
    metadata: {
      clientId: authRequest.clientId,
      organizationId: context.organizationId,
    },
    scope: scopes,
    props,
    // One client id can serve several installs of one Caldrin Search user: ChatGPT
    // reuses the client it registered for an app, and Claude can hold one for
    // a directory entry. Revoking the user's other grants for the client
    // (the library default) signed the earlier install out on every new
    // connect. Unused grants expire after 30 idle days instead, and each one is
    // a row under Settings "Connected agents" that can be disconnected.
    revokeExistingGrants: false,
  });

  await recordMcpAuthorized(context.organizationId);
  // Connecting an agent is the last onboarding step, so this finishes
  // onboarding for people who paste the setup prompt and never return to the
  // wizard.
  await completeOnboardingFromAgent(context, "agent_connect");

  waitUntil(
    captureServerEvent({
      distinctId: context.userId,
      event: "mcp:authorize_success",
      organizationId: context.organizationId,
      properties: {
        client_id: authRequest.clientId,
        scopes: scopes.join(" "),
      },
    }),
  );

  return redirectTo;
}

// Request helpers for the consent handlers.

export const OAUTH_AUTHORIZATION_PARAM_NAMES = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

export function getRelativeRequestTarget(request: Request) {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

export function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function csrfProtected(request: Request) {
  const origin = request.headers.get("Origin");
  return origin === getPublicOrigin(request);
}

export async function resolveContextForConsent(request: Request) {
  try {
    return await resolveSessionContext(request.headers);
  } catch (error) {
    const appError = asAppError(error);
    if (appError?.code === "UNAUTHENTICATED") {
      return null;
    }
    throw error;
  }
}

export function buildAuthorizeRequestFromConsentQuery(
  request: Request,
  query: string,
) {
  const authorizeUrl = new URL(OAUTH_AUTHORIZE_PATH, request.url);
  const params = new URLSearchParams(query);

  for (const key of OAUTH_AUTHORIZATION_PARAM_NAMES) {
    for (const value of params.getAll(key)) {
      authorizeUrl.searchParams.append(key, value);
    }
  }

  return new Request(authorizeUrl.toString(), {
    headers: request.headers,
  });
}

export function getGrantedMcpScopes(requestedScopes: string[]) {
  if (requestedScopes.length === 0) {
    return [...MCP_OAUTH_SCOPES];
  }

  const requested = new Set(requestedScopes);
  const granted = MCP_OAUTH_SCOPES.filter((scope) => requested.has(scope));

  if (!granted.includes(MCP_SCOPE)) {
    throw new Error("The mcp scope is required");
  }

  return granted;
}
