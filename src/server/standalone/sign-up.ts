import { APIError } from "better-auth/api";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { isSesConfigured } from "@/server/email/ses";
import { isDisposableEmailDomain } from "@/server/auth/disposable-email";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { isOperatorRequest } from "@/server/standalone/operator-auth";

const signUpBodySchema = z.object({ email: z.string() });

// Password mode closes public registration. Two sign-ups are
// still allowed from the browser: the first account on a fresh installation,
// which becomes the administrator, and an address that holds a pending
// invitation, which joins the inviter's organization. Everything else comes
// from the operator command (src/server/standalone/admin.ts).
export async function isFirstAccountOpen(): Promise<boolean> {
  return !(await AuthRepository.hasAnyUser());
}

// Open sign-up (OPEN_SIGNUP=true) covers only the paths that prove the
// address: Google and a magic link. Email-and-password sign-up stays closed.
export function isOpenSignUp(): boolean {
  return env.OPEN_SIGNUP?.trim() === "true";
}

// Email-and-password sign-up is open only where every address is confirmed by
// email first (SES). Without that, a stranger could register someone else's
// address and later share an account with their Google sign-in.
export function isEmailSignUpOpen(): boolean {
  return isOpenSignUp() && isSesConfigured();
}

export async function isStandaloneSignUpOpen(
  email: string | undefined,
): Promise<boolean> {
  if (await isFirstAccountOpen()) return true;
  if (!email) return false;
  return AuthRepository.hasPendingInvitationForEmail(email);
}

// The Better Auth sign-up hook. The operator command, which carries the
// operator secret, may always create an account.
export async function assertStandaloneSignUpOpen(
  headers: Headers | undefined,
  body: unknown,
): Promise<void> {
  if (isOperatorRequest(headers)) return;
  if (isEmailSignUpOpen()) {
    const email = signUpBodySchema.safeParse(body).data?.email;
    if (email) assertOpenSignUpEmail(email, true);
    return;
  }
  const parsed = signUpBodySchema.safeParse(body);
  if (
    await isStandaloneSignUpOpen(parsed.success ? parsed.data.email : undefined)
  )
    return;
  throw new APIError("FORBIDDEN", {
    message: "Registration is closed. Ask an administrator for an invitation.",
  });
}

// Better Auth's limiter for the standalone runtime. Each magic-link request
// sends an email, so one visitor can't use it to mail someone repeatedly.
export const STANDALONE_RATE_LIMIT = {
  enabled: true,
  customRules: {
    "/sign-in/magic-link": { window: 60, max: 3 },
    "/sign-in/email-otp": { window: 60, max: 10 },
  },
};

// Under open sign-up every new workspace starts on a free test run, capped by
// the trial budget; after that it brings its own keys or upgrades.
export async function provisionOpenSignUpWorkspace(
  organizationId: string,
  standalone: boolean,
): Promise<void> {
  if (!standalone || !isOpenSignUp()) return;
  const { setWorkspaceMode } =
    await import("@/server/features/workspace/credentials");
  await setWorkspaceMode(organizationId, "trial");
}

export function assertOpenSignUpEmail(email: string, standalone: boolean) {
  if (standalone && isOpenSignUp() && isDisposableEmailDomain(email)) {
    throw new APIError("BAD_REQUEST", {
      code: "disposable_email",
      message: "Please sign up with a non-disposable email address.",
    });
  }
}
