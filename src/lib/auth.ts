import { runAfterResponse } from "@/server/lib/background";
import { captureServerEvent } from "@/server/lib/posthog";
/* eslint-disable max-lines -- the one Better Auth configuration: every hook and plugin lives here */
import { INVITABLE_ROLES } from "@/lib/org-permissions";
import { applyInvitationProjects } from "@/server/auth/project-access";
import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { captcha } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import * as d1Schema from "@/db/d1/schema";
import { d1Db } from "@/db/d1/client";
import { pgDb } from "@/db/pg/client";
import * as pgSchema from "@/db/pg/schema";
import { getDatabaseProvider } from "@/db/provider";
import { z } from "zod";
import { getAuthMode, usesBetterAuth } from "@/lib/auth-mode";
import { createApiKeyPlugin } from "@/lib/auth-api-key";
import { getActiveOrganizationId } from "@/lib/auth-session";
import { createBaseAuthConfig } from "@/lib/auth-config";
import { getOpenSignUpTurnstileSecretKey } from "@/lib/auth-turnstile";
import { resolveSignInOrganization } from "@/server/auth/default-organization";
import { onInvitationAccepted } from "@/server/auth/invited-member";
import { requirePlatformSeat } from "@/server/features/billing/platformAccess";
import { AppError } from "@/server/lib/errors";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { GoogleAccountService } from "@/server/features/google/GoogleAccountService";
import {
  assertStandaloneSignUpOpen,
  assertOpenSignUpEmail,
  isEmailSignUpOpen,
  isOpenSignUp,
  isStandaloneSignUpOpen,
  provisionOpenSignUpWorkspace,
  STANDALONE_RATE_LIMIT,
} from "@/server/standalone/sign-up";
import { magicLink } from "better-auth/plugins/magic-link";
import { emailOTP } from "better-auth/plugins/email-otp";
import { signUpBrowserPassword } from "@/server/auth/signup-browser";
import { dropUnprovenCredentials } from "@/server/auth/unproven-account";
import {
  SIGN_IN_CODE_TTL_SECONDS,
  createSignInCode,
} from "@/server/auth/sign-in-code";
import {
  isSesConfigured,
  sendMagicLinkEmail,
  sendPasswordResetEmailSes,
  sendVerificationEmailSes,
} from "@/server/email/ses";

const baseUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  }, "BETTER_AUTH_URL must use https or a loopback host");

// The member row /organization/leave returns once it has been deleted.
const leftMemberSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
});

async function checkMemberSeat(
  organizationId: string,
  role: string,
  excludingUserId?: string,
) {
  try {
    await requirePlatformSeat(organizationId, role, excludingUserId);
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      throw new APIError("FORBIDDEN", { message: error.message });
    }
    throw error;
  }
}

function createAuth() {
  // Modes with their own accounts need the real configured URL (cookies,
  // callbacks, /api/auth routes all use it). The other self-hosted modes only
  // build this instance to mint/refresh Search Console tokens, which never
  // read baseURL — so a placeholder is fine there.
  const baseUrl = usesBetterAuth(env.AUTH_MODE)
    ? getBaseUrl()
    : "http://localhost";
  // Accounts come from the first visit, invitation links, open sign-up, or the
  // operator's commands (src/server/standalone/admin.ts). Email is verified
  // only where open email sign-up is on and SES can send the link.
  const standalone = getAuthMode(env.AUTH_MODE) === "password";
  const emailSignUp = standalone && isEmailSignUpOpen();
  const bypassEmail = standalone
    ? !emailSignUp
    : Reflect.get(env, "BYPASS_EMAIL_VERIFICATION") === "true";
  const baseAuthConfig = createBaseAuthConfig(
    usesBetterAuth(env.AUTH_MODE)
      ? {
          organization: {
            // No sendInvitationEmail here on purpose: better-auth swallows a
            // throw from that callback, so a failed send would still read as
            // "sent" in the UI. The invite email is sent (and rate limited)
            // by the sendTeamInvitation server function instead, which fails
            // the call visibly. Side effect worth knowing: hitting the raw
            // /api/auth/organization/invite-member endpoint creates a pending
            // invitation but emails nobody.
            organizationHooks: {
              afterCreateOrganization: ({ organization }) =>
                provisionOpenSignUpWorkspace(organization.id, standalone),
              // The endpoint accepts any role string; enforce server-side. This
              // also keeps an owner from minting a second owner and leaving —
              // the path that would re-mint a fresh org + free-plan grant at
              // next sign-in.
              beforeCreateInvitation: async ({ invitation }) => {
                if (
                  !(INVITABLE_ROLES as readonly string[]).includes(
                    invitation.role,
                  )
                ) {
                  throw new APIError("BAD_REQUEST", {
                    message: "Select a valid workspace role.",
                  });
                }
                await checkMemberSeat(
                  invitation.organizationId,
                  invitation.role,
                );
              },
              beforeAcceptInvitation: async ({ invitation, user }) => {
                const existing = await AuthRepository.getMembership(
                  user.id,
                  invitation.organizationId,
                );
                if (existing) {
                  throw new APIError("BAD_REQUEST", {
                    message: "You are already a member of this organization.",
                  });
                }
                await checkMemberSeat(
                  invitation.organizationId,
                  invitation.role ?? "member",
                );
              },
              // The invite flow only ever mints "admin", but the raw
              // update-member-role endpoint accepts any role string and the
              // plugin lets an owner grant owner to another member. Owners
              // control billing, so a second owner is a billing-escalation
              // path (and, if the first owner then leaves, a fresh-org /
              // free-grant loop at next sign-in). Ownership moves only through
              // the transferOwnership server function, which swaps the two
              // roles atomically — reject owner here.
              beforeUpdateMemberRole: async ({ newRole, member }) => {
                if (
                  newRole
                    .split(",")
                    .map((r) => r.trim())
                    .includes("owner")
                ) {
                  throw new APIError("BAD_REQUEST", {
                    message:
                      "The owner role can't be granted from here. Use Transfer ownership in organization settings.",
                  });
                }
                if (!(INVITABLE_ROLES as readonly string[]).includes(newRole)) {
                  throw new APIError("BAD_REQUEST", {
                    message: "Select one workspace role.",
                  });
                }
                if ((newRole === "scoped") !== (member.role === "scoped")) {
                  await checkMemberSeat(
                    member.organizationId,
                    newRole,
                    member.userId,
                  );
                }
              },
              // Before, not after: a failed disconnect then fails the removal,
              // which the admin can retry, instead of leaving a removed
              // member's Google grant serving the organization. Leaving on
              // one's own skips these hooks; the after hook below covers it.
              beforeRemoveMember: async ({ member: removedMember }) => {
                await GoogleAccountService.disconnectMember(
                  removedMember.userId,
                  removedMember.organizationId,
                );
              },
              afterAcceptInvitation: async ({
                invitation,
                member: acceptedMember,
              }) => {
                await applyInvitationProjects(
                  invitation.id,
                  acceptedMember.organizationId,
                  acceptedMember.userId,
                );
                await onInvitationAccepted({
                  userId: acceptedMember.userId,
                  organizationId: acceptedMember.organizationId,
                });
              },
            },
          },
        }
      : undefined,
  );

  const openSignUpTurnstileSecretKey = getOpenSignUpTurnstileSecretKey(env);

  const database =
    getDatabaseProvider() === "postgres"
      ? drizzleAdapter(pgDb, {
          provider: "pg",
          schema: pgSchema,
        })
      : drizzleAdapter(d1Db, {
          provider: "sqlite",
          schema: d1Schema,
        });

  const auth = betterAuth({
    baseURL: baseUrl,
    secret: getSecret(),
    logger: {
      log: (level, message, ...args: unknown[]) => {
        // The api-key plugin logs every verification failure at error level — a
        // stale key or a throttled caller included. The /mcp handler already logs
        // the response it returns at the right level (debug for 401, warn for 429),
        // so drop the duplicate.
        if (message.startsWith("Failed to validate API key")) return;
        // "Failed to parse state" is user/browser behavior: a replayed OAuth
        // callback URL (back button, restored tab), or a consent screen left
        // open past the state's lifetime. The request already redirects the
        // user to an error page; nothing here is on-call actionable.
        const effectiveLevel =
          level === "error" && message === "Failed to parse state"
            ? "warn"
            : level;
        // Also drops Better Auth's ISO-timestamp prefix, which makes every log
        // line fingerprint as its own error group in observability.
        console[effectiveLevel === "debug" ? "log" : effectiveLevel](
          `[better-auth] ${message}`,
          ...args,
        );
      },
    },
    ...baseAuthConfig,
    // Standalone reads every session from the database so an operator
    // password reset revokes it at once (see auth-options.ts for the
    // trade-off).
    session: standalone
      ? { ...baseAuthConfig.session, cookieCache: { enabled: false } }
      : baseAuthConfig.session,
    // Better Auth turns its rate limiter on only when NODE_ENV is
    // "production", which the standalone runtime does not set, so password
    // guessing against /sign-in/email was unlimited there. The memory store
    // is enough: the runtime keeps the app alive between requests.
    ...(standalone ? { rateLimit: STANDALONE_RATE_LIMIT } : {}),
    advanced: baseAuthConfig.advanced,
    emailAndPassword: {
      ...baseAuthConfig.emailAndPassword,
      requireEmailVerification: !bypassEmail,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      // Standalone: the operator's create-user call must not mint a session
      // for anyone. A reset link needs an email transport: SES.
      ...(standalone ? { autoSignIn: false } : {}),
      ...(!standalone || emailSignUp
        ? {
            sendResetPassword: ({ user, url }) =>
              sendPasswordResetEmailSes(user.email, url),
          }
        : {}),
    },
    emailVerification: bypassEmail
      ? undefined
      : {
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
          sendVerificationEmail: ({ user, url }) =>
            sendVerificationEmailSes(user.email, url),
        },
    socialProviders: getSocialProviders(),
    // Where Google sign-in failures land (canceled consent screen, replayed
    // callback URLs). Without this the default /api/auth/error page 302s to
    // `/?error=...` and the dashboard silently discards the code. Modes
    // without accounts never serve social sign-in, so the placeholder baseUrl
    // there is harmless.
    onAPIError: { errorURL: `${baseUrl}/auth-error` },
    trustedOrigins: getTrustedOrigins(baseUrl),
    database,
    plugins: [
      ...baseAuthConfig.plugins,
      ...(usesBetterAuth(env.AUTH_MODE) ? [createApiKeyPlugin()] : []),
      ...signUpCaptchaPlugins(openSignUpTurnstileSecretKey),
      ...(bypassEmail ? [] : [signUpBrowserPassword()]),
      ...(standalone && isSesConfigured()
        ? [
            magicLink({
              expiresIn: 60 * 10,
              sendMagicLink: async ({ email, url }, ctx) => {
                // Stay silent for an address that could not sign in anyway, so
                // the form never reveals who has an account.
                if (
                  !(await AuthRepository.hasUserWithEmail(email)) &&
                  !isOpenSignUp() &&
                  !(await isStandaloneSignUpOpen(email))
                ) {
                  return;
                }
                const code = ctx ? await createSignInCode(ctx, email) : null;
                await sendMagicLinkEmail(email, url, code);
              },
            }),
            // Verifies the code in the same email as the link. The plugin's
            // own send endpoints stay inert: codes are only ever created above,
            // after the sign-in check, never on request.
            emailOTP({
              expiresIn: SIGN_IN_CODE_TTL_SECONDS,
              async sendVerificationOTP() {},
            }),
          ]
        : []),
      tanstackStartCookies(),
    ],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Standalone closes registration (src/server/standalone/sign-up.ts).
        if (standalone && ctx.path === "/sign-up/email")
          return assertStandaloneSignUpOpen(ctx.headers, ctx.body);

        // Binds a new MCP API key to the organization the session is working
        // in, server-side: the /mcp handler reads metadata.organizationId and
        // bills/authorizes that org for the key's lifetime. The session's
        // active org is only a hint; the member row is the authorization fact.
        // Throwing here means an unbound key can never be minted through the
        // HTTP endpoint. Better Auth merges the returned body over the
        // request's, so an organizationId the client sends loses to this one.
        // The owner can still rewrite metadata through /api-key/update, which
        // gains nothing: a key pointed at an org they are not in fails the
        // membership check on its next /mcp call, and one pointed at an org
        // they are in is no different from a key created there.
        if (ctx.path !== "/api-key/create") return;
        // A server-side auth.api.createApiKey call (no request, no headers) is
        // trusted code that names the user and stamps metadata itself. The
        // plugin uses the same test to tell server calls apart, and refuses a
        // client-supplied userId on any call that has a request.
        if (!ctx.request && !ctx.headers) return;
        // Minting a credential must see the stored session, not the cookie
        // cache: a cookie from a session revoked minutes ago must not mint a
        // key that outlives the revocation. The plugin reuses this lookup.
        const session = await getSessionFromCtx(ctx, {
          disableCookieCache: true,
        });
        if (!session) throw new APIError("UNAUTHORIZED");
        const organizationId = getActiveOrganizationId(session);
        const membership = organizationId
          ? await AuthRepository.getMembership(session.user.id, organizationId)
          : null;
        if (!organizationId || !membership) {
          throw new APIError("FORBIDDEN", {
            message: "Select an organization before creating an API key.",
          });
        }
        return { context: { body: { metadata: { organizationId } } } };
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/organization/leave") {
          const left = leftMemberSchema.safeParse(ctx.context.returned);
          if (left.success)
            await GoogleAccountService.disconnectMember(
              left.data.userId,
              left.data.organizationId,
            );
          return;
        }
      }),
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account, ctx) => {
            // Linking Google to a never-confirmed account (see
            // requireLocalEmailVerified in auth-config.ts).
            if (account.providerId === "google" && ctx)
              await dropUnprovenCredentials(ctx, account.userId);
            return { data: account };
          },
        },
      },
      user: {
        create: {
          before: async (user, ctx) => {
            // Google and magic-link arrivals create their account here. Email
            // sign-up has its own gate (hooks.before) and the operator command
            // is trusted; neither takes these paths.
            const path = ctx?.path ?? "";
            if (
              standalone &&
              (path.startsWith("/callback/") ||
                path === "/magic-link/verify" ||
                path === "/sign-in/email-otp") &&
              !isOpenSignUp() &&
              !(await isStandaloneSignUpOpen(user.email))
            ) {
              // A code makes Better Auth redirect an OAuth callback to the
              // error page instead of answering with JSON.
              throw new APIError("FORBIDDEN", {
                code: "registration_closed",
                message:
                  "Registration is closed. Ask an administrator for an invitation.",
              });
            }
            assertOpenSignUpEmail(user.email, standalone);
            return { data: user };
          },
          after: async (user, ctx) => {
            if (!ctx?.path) return;
            await runAfterResponse(
              captureServerEvent({
                distinctId: user.id,
                organizationId: null,
                event: "onboarding:signed_up",
              }),
            );
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            // Runs on every sign-in (each sign-in mints a session row). Resolves
            // the active org:
            // last-active org while still a member → most recently joined → a
            // new default one — except a membership-less user with a pending
            // invitation gets none (null active org), so accepting leaves them
            // in exactly the inviter's org. createOrganization is injected so
            // the helper needn't import auth.ts and create a cycle.
            const resolved = await resolveSignInOrganization(
              session.userId,
              (body) => auth.api.createOrganization({ body }),
            );

            return {
              data: {
                ...session,
                activeOrganizationId: resolved?.organizationId ?? null,
              },
            };
          },
        },
      },
    },
  });

  return auth;
}

let authInstance: ReturnType<typeof createAuth> | null = null;

function getTrustedOrigins(baseUrl: string) {
  const trustedOrigins = [baseUrl];

  if (process.env.NODE_ENV !== "production") {
    trustedOrigins.push(
      "http://caldrin-search.localhost:1355",
      "http://*.caldrin-search.localhost:1355",
      "https://caldrin-search.localhost:1355",
      "https://*.caldrin-search.localhost:1355",
    );
  }

  return trustedOrigins;
}

export function getBaseUrl() {
  const baseUrl = env.BETTER_AUTH_URL?.trim();

  if (!baseUrl) {
    throw new Error("BETTER_AUTH_URL is required in password mode");
  }

  return baseUrlSchema.parse(baseUrl);
}

// Required in password mode, and in the other modes when Search Console is
// enabled (it keys the OAuth-token encryption and is needed to build the auth
// instance that mints/refreshes Search Console tokens).
function getSecret() {
  const secret = env.BETTER_AUTH_SECRET?.trim();

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }

  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }

  return secret;
}

function getSocialProviders() {
  // Password mode offers Google sign-in when the operator set the client, for
  // existing accounts and invited emails unless open sign-up is on. The other
  // modes build the auth instance only for sessions and the token-encryption
  // secret that Search Console / Analytics grants use (googleOAuth.ts), so it
  // must not require the social-login config.
  if (
    getAuthMode(env.AUTH_MODE) === "password" &&
    env.GOOGLE_CLIENT_ID?.trim() &&
    env.GOOGLE_CLIENT_SECRET?.trim()
  ) {
    return {
      google: {
        clientId: env.GOOGLE_CLIENT_ID.trim(),
        clientSecret: env.GOOGLE_CLIENT_SECRET.trim(),
        mapProfileToUser: (profile: { name?: string }) => ({
          name: profile.name,
        }),
      },
    };
  }
  return {};
}

// Whether this deployment can serve its own accounts: password mode needs only
// the URL and the secret.
export function hasBetterAuthConfig() {
  try {
    getBaseUrl();
    getSecret();
    return getAuthMode(env.AUTH_MODE) === "password";
  } catch {
    return false;
  }
}

// Open sign-up guards the magic-link request, the only open path that sends
// mail on a stranger's behalf. Without a secret there is no challenge.
function signUpCaptchaPlugins(secretKey?: string) {
  if (!secretKey) return [];
  return [
    captcha({
      provider: "cloudflare-turnstile",
      secretKey,
      endpoints: ["/sign-in/magic-link", "/sign-up/email"],
    }),
  ];
}

export function getAuth() {
  if (authInstance) {
    return authInstance;
  }

  authInstance = createAuth();

  return authInstance;
}
