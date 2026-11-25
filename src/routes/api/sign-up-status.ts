import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { getAuthMode } from "@/lib/auth-mode";
import { isSesConfigured } from "@/server/email/ses";
import { isEmailSignUpOpen, isOpenSignUp } from "@/server/standalone/sign-up";

// Unauthenticated: tells the sign-in and sign-up pages whether this standalone
// installation still has no account, so its first visitor can create the
// administrator's (every other mode answers false without a database read).
async function handleSignUpStatusRequest(): Promise<Response> {
  let firstAccount = false;
  if (getAuthMode(env.AUTH_MODE) === "password") {
    const { isFirstAccountOpen } = await import("@/server/standalone/sign-up");
    firstAccount = await isFirstAccountOpen();
  }
  const passwordMode = getAuthMode(env.AUTH_MODE) === "password";
  return Response.json(
    {
      firstAccount,
      googleSignIn:
        passwordMode &&
        Boolean(
          env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim(),
        ),
      magicLink: passwordMode && isSesConfigured(),
      openSignUp: passwordMode && isOpenSignUp(),
      emailSignUp: passwordMode && isEmailSignUpOpen(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/sign-up-status")({
  server: {
    handlers: {
      GET: () => handleSignUpStatusRequest(),
    },
  },
});
