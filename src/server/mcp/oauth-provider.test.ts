import {
  AuthorizationError as ProviderAuthorizationError,
  GrantType,
  OAuthError as ProviderOAuthError,
  type OAuthProviderOptions,
  type TokenExchangeCallbackOptions,
} from "@cloudflare/workers-oauth-provider";
import type * as WorkersOAuthProvider from "@cloudflare/workers-oauth-provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveSessionContext } from "@/middleware/ensure-user/session";
import { createCaldrinSearchOAuthProvider } from "./oauth-provider";

const mocks = vi.hoisted(() => ({
  options: [] as OAuthProviderOptions<unknown>[],
  requests: [] as Request[],
  purges: [] as unknown[],
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: (promise: Promise<unknown>) => void promise,
  // oxlint-disable-next-line typescript/no-extraneous-class -- runtime shim for the real provider's exported classes
  WorkerEntrypoint: class {},
  // api-key-auth pulls the db client into this module graph; it reads env at
  // module load.
  env: {},
}));

vi.mock("@cloudflare/workers-oauth-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkersOAuthProvider>();
  return {
    ...actual,
    OAuthProvider: class {
      constructor(options: OAuthProviderOptions<unknown>) {
        mocks.options.push(options);
      }

      fetch(request: Request) {
        mocks.requests.push(request);
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      purgeExpiredData(env: unknown, options?: { batchSize?: number }) {
        mocks.purges.push({ env, options });
        return Promise.resolve({
          grantsChecked: 0,
          grantsPurged: 0,
          tokensChecked: 0,
          tokensPurged: 0,
          done: true,
        });
      }
    },
  };
});

vi.mock("@/lib/auth", () => ({
  getBaseUrl: () => "https://search.example.com",
}));

vi.mock("@/middleware/ensure-user/session", () => ({
  resolveSessionContext: vi.fn(),
}));

vi.mock("@/server/features/activation/mcpActivation", () => ({
  recordMcpAuthorized: vi.fn(),
  completeOnboardingFromAgent: vi.fn(),
  markMcpConnected: vi.fn(),
}));

vi.mock("@/server/lib/posthog", () => ({
  captureServerEvent: vi.fn(),
}));

vi.mock("@/server/mcp/transport", () => ({
  handleAuthenticatedCaldrinSearchMcpRequest: vi.fn(),
}));

const executionContext = {
  props: {},
  waitUntil() {},
  passThroughOnException() {},
} as ExecutionContext;

async function dispatch(
  provider: ReturnType<typeof createCaldrinSearchOAuthProvider>,
  request: Request,
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mocked provider does not read its KV-backed environment in these configuration tests
  return provider.fetch(request, {} as never, executionContext);
}

function tokenExchangeOptions(
  requestedScope: string[],
): TokenExchangeCallbackOptions<unknown> {
  return {
    grantType: GrantType.REFRESH_TOKEN,
    clientId: "client-1",
    subjectClientId: "client-1",
    userId: "user-1",
    grantId: "grant-1",
    resource: "https://search.example.com/mcp",
    env: {},
    scope: ["offline_access", "mcp"],
    requestedScope,
    props: {
      caldrinSearchAuth: {
        userId: "user-1",
        userEmail: "user@example.com",
        organizationId: "org-1",
        baseUrl: "https://search.example.com",
        clientId: "client-1",
        scopes: ["offline_access", "mcp"],
      },
    },
  };
}

async function invokeDefaultHandler(
  request: Request,
  env: Record<string, unknown>,
) {
  const defaultHandler = mocks.options[0]?.defaultHandler;
  if (
    !defaultHandler ||
    typeof defaultHandler !== "object" ||
    !("fetch" in defaultHandler) ||
    typeof defaultHandler.fetch !== "function"
  ) {
    throw new Error("Missing default handler");
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Workers' handler type requires incoming-only CF metadata; this test Request never inspects request.cf
  const workerRequest = request as Request<
    unknown,
    IncomingRequestCfProperties
  >;
  const rawResponse: unknown = await defaultHandler.fetch(
    workerRequest,
    env,
    executionContext,
  );
  if (!(rawResponse instanceof Response)) {
    throw new Error("Default handler did not return a response");
  }
  return rawResponse;
}

describe("Caldrin Search OAuth provider configuration", () => {
  beforeEach(() => {
    mocks.options.length = 0;
    mocks.requests.length = 0;
    mocks.purges.length = 0;
    // Nobody is signed in.
    vi.mocked(resolveSessionContext).mockRejectedValue(
      new Error("UNAUTHENTICATED"),
    );
  });

  it("binds tokens and protected-resource metadata to the canonical MCP URL", async () => {
    const provider = createCaldrinSearchOAuthProvider(
      () => new Response("app"),
    );

    await dispatch(provider, new Request("https://search.example.com/health"));

    expect(mocks.options).toHaveLength(1);
    expect(mocks.options[0]?.resourceMetadata).toMatchObject({
      resource: "https://search.example.com/mcp",
    });
  });

  it("rejects token exchanges that drop the required MCP scope", async () => {
    const provider = createCaldrinSearchOAuthProvider(
      () => new Response("app"),
    );

    await dispatch(provider, new Request("https://search.example.com/health"));

    const callback = mocks.options[0]?.tokenExchangeCallback;
    if (!callback) throw new Error("Missing token exchange callback");
    expect(() =>
      callback(tokenExchangeOptions(["offline_access"])),
    ).toThrowError(ProviderOAuthError);
    expect(callback(tokenExchangeOptions(["mcp"]))).toEqual({
      accessTokenProps: {
        caldrinSearchAuth: {
          userId: "user-1",
          userEmail: "user@example.com",
          organizationId: "org-1",
          baseUrl: "https://search.example.com",
          clientId: "client-1",
          scopes: ["mcp"],
        },
      },
    });
  });

  it("lets the provider issue Perplexity a real client secret", async () => {
    const provider = createCaldrinSearchOAuthProvider(
      () => new Response("app"),
    );

    await dispatch(
      provider,
      new Request("https://search.example.com/api/auth/oauth2/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Perplexity",
          redirect_uris: ["https://www.perplexity.ai/api/mcp/oauth/callback"],
        }),
      }),
    );

    await expect(mocks.requests[0]?.json()).resolves.toMatchObject({
      token_endpoint_auth_method: "client_secret_post",
    });
  });

  it("includes the authorization-server issuer when consent is denied", async () => {
    const provider = createCaldrinSearchOAuthProvider(
      () => new Response("app"),
    );
    await dispatch(provider, new Request("https://search.example.com/health"));

    const response = await invokeDefaultHandler(
      new Request("https://search.example.com/api/oauth/consent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://search.example.com",
        },
        body: JSON.stringify({ accept: false, query: "state=state-1" }),
      }),
      {
        OAUTH_PROVIDER: {
          parseAuthRequest: () =>
            Promise.resolve({
              clientId: "client-1",
              redirectUri: "https://client.example/callback",
              scope: ["mcp"],
              state: "state-1",
              issuer: "https://search.example.com",
            }),
        },
      },
    );

    const body = z
      .object({ redirectTo: z.string().url() })
      .parse(await response.json());
    expect(
      Object.fromEntries(new URL(body.redirectTo).searchParams),
    ).toMatchObject({
      error: "access_denied",
      state: "state-1",
      iss: "https://search.example.com",
    });
  });

  it("redirects safe authorization errors with state and issuer, rethrowing anything else", async () => {
    const provider = createCaldrinSearchOAuthProvider(
      () => new Response("app"),
    );
    await dispatch(provider, new Request("https://search.example.com/health"));

    const response = await invokeDefaultHandler(
      new Request("https://search.example.com/api/auth/oauth2/authorize"),
      {
        OAUTH_PROVIDER: {
          parseAuthRequest: () =>
            Promise.reject(
              new ProviderAuthorizationError("invalid_scope", {
                description: "Unsupported scope",
                redirectUri: "https://client.example/callback",
                state: "state-1",
                issuer: "https://search.example.com",
              }),
            ),
        },
      },
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("Location");
    if (!location) throw new Error("Missing OAuth redirect");
    expect(Object.fromEntries(new URL(location).searchParams)).toMatchObject({
      error: "invalid_scope",
      error_description: "Unsupported scope",
      state: "state-1",
      iss: "https://search.example.com",
    });

    // Anything other than a provider AuthorizationError is not a client error.
    await expect(
      invokeDefaultHandler(
        new Request("https://search.example.com/api/auth/oauth2/authorize"),
        {
          OAUTH_PROVIDER: {
            parseAuthRequest: () =>
              Promise.reject(new Error("internal storage detail")),
          },
        },
      ),
    ).rejects.toThrow("internal storage detail");
  });

  it("sends someone who is not signed in to the sign-in page, then back to authorize", async () => {
    const provider = createCaldrinSearchOAuthProvider(
      () => new Response("app"),
    );
    await dispatch(provider, new Request("https://search.example.com/health"));
    const response = await invokeDefaultHandler(
      new Request(
        "https://search.example.com/api/auth/oauth2/authorize?state=1",
      ),
      {
        OAUTH_PROVIDER: {
          parseAuthRequest: () =>
            Promise.resolve({ redirectUri: "https://chatgpt.com/callback" }),
        },
      },
    );
    const signIn = new URL(response.headers.get("Location") ?? "");
    expect(signIn.pathname).toBe("/sign-in");
    expect(signIn.searchParams.get("redirect")).toBe(
      "/api/auth/oauth2/authorize?state=1",
    );
  });
});
