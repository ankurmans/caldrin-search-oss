import { getAuthMode } from "@/lib/auth-mode";

type TurnstileAuthEnv = {
  AUTH_MODE?: string;
  OPEN_SIGNUP?: string;
  TURNSTILE_SECRET_KEY?: string;
};

// Open sign-up: the challenge guards the magic-link request (the only open path
// that sends mail on a stranger's behalf). Google sign-in is not gated; Google
// has already vetted that account.
export function getOpenSignUpTurnstileSecretKey(env: TurnstileAuthEnv) {
  if (getAuthMode(env.AUTH_MODE) !== "password") return undefined;
  if (env.OPEN_SIGNUP?.trim() !== "true") return undefined;
  return env.TURNSTILE_SECRET_KEY?.trim() || undefined;
}
