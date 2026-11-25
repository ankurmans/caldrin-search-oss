import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { z } from "zod";
import { dropUnprovenCredentials } from "@/server/auth/unproven-account";

// Whoever signs up with email and password need not own the address, and the
// owner opening the link would otherwise activate that stranger's password.
// So the password survives verification only in the browser that created the
// account. Anywhere else the link still confirms the address and signs in, and
// the password is set again through "Forgot password".

const COOKIE_PREFIX = "caldrin_signup_";
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const signedUpSchema = z.object({ user: z.object({ id: z.string() }) });

async function proof(secret: string, userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`sign-up-browser:${userId}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function signUpBrowserPassword(): BetterAuthPlugin {
  return {
    id: "sign-up-browser-password",
    init(context) {
      return {
        options: {
          emailVerification: {
            // Runs on every first verification, before the address is marked
            // confirmed.
            async beforeEmailVerification(user, request) {
              const cookie = `${COOKIE_PREFIX}${user.id}=${await proof(context.secret, user.id)}`;
              const sent = request?.headers.get("cookie")?.split(/;\s*/);
              if (sent?.includes(cookie)) return;
              await dropUnprovenCredentials({ context }, user.id);
            },
          },
        },
      };
    },
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === "/sign-up/email",
          // An address that is already registered answers with a made-up user
          // id, so a second sign-up cannot vouch for the first one's password.
          handler: createAuthMiddleware(async (ctx) => {
            const result = signedUpSchema.safeParse(ctx.context.returned);
            if (!result.success) return;
            const { id } = result.data.user;
            ctx.setCookie(
              `${COOKIE_PREFIX}${id}`,
              await proof(ctx.context.secret, id),
              {
                httpOnly: true,
                secure: ctx.context.baseURL.startsWith("https://"),
                sameSite: "lax",
                path: "/",
                maxAge: COOKIE_MAX_AGE_SECONDS,
              },
            );
          }),
        },
      ],
    },
  };
}
