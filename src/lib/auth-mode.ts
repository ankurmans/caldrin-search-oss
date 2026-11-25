import { z } from "zod";

// - cloudflare_access / local_noauth: self-hosted, identity comes from outside
//   the app (an Access JWT, or a fixed local admin); no accounts of its own.
// - password: the app's own accounts. Better Auth accounts (email and
//   password, magic link, Google, organizations, invitations, API keys); the
//   first visitor creates the administrator's account and invitations add the
//   rest.
export const AUTH_MODES = [
  "cloudflare_access",
  "local_noauth",
  "password",
] as const;

type AuthMode = (typeof AUTH_MODES)[number];

const authModeSchema = z.enum(AUTH_MODES);

const warnedInvalidAuthModes = new Set<string>();

export function getAuthMode(value: string | null | undefined): AuthMode {
  const parsed = authModeSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  // Unset stays a silent fail-closed default; a SET-but-invalid value is a
  // typo the operator needs to hear about — silently coercing it made every
  // request fail with a Cloudflare Access error about a mode they never chose.
  if (value && !warnedInvalidAuthModes.has(value)) {
    warnedInvalidAuthModes.add(value);
    console.error(
      `Invalid AUTH_MODE "${value}" — falling back to "cloudflare_access". Valid values: ${AUTH_MODES.join(", ")}.`,
    );
  }

  return "cloudflare_access";
}

// True when the app runs its own accounts (sessions, organizations,
// invitations, API keys).
export function usesBetterAuth(value: string | null | undefined) {
  return getAuthMode(value) === "password";
}

// The client bundle inlines AUTH_MODE at build time (vite envPrefix), so a
// deployment must build and run with the same value. The server also records
// its runtime mode per request (server.ts) and prints it into the document
// (__root.tsx) for the browser; both sides prefer that value and fall back to
// the build-time one.
declare global {
  // `var` is how a property of globalThis is declared.
  var __CALDRIN_SEARCH_AUTH_MODE__: string | undefined;
}

export function setRuntimeAuthMode(value: string | undefined) {
  globalThis.__CALDRIN_SEARCH_AUTH_MODE__ = value;
}

export function getClientAuthMode() {
  return getAuthMode(
    globalThis.__CALDRIN_SEARCH_AUTH_MODE__ ?? import.meta.env.AUTH_MODE,
  );
}

export function runtimeAuthModeScript() {
  return `globalThis.__CALDRIN_SEARCH_AUTH_MODE__=${JSON.stringify(getClientAuthMode())}`;
}

export function usesBetterAuthClient() {
  return usesBetterAuth(getClientAuthMode());
}

export function isEmailVerificationBypassed() {
  // Local-dev escape hatch (BYPASS_EMAIL_VERIFICATION=true). The server skips
  // verification and never marks users emailVerified, so the client must treat
  // the session as verified too — otherwise route guards and /verify-email
  // bounce each other in an infinite redirect loop.
  // Password mode has no email transport: accounts are created in the browser
  // (first visitor, invitation links) or by the operator and never confirm an
  // address.
  return (
    import.meta.env.BYPASS_EMAIL_VERIFICATION === "true" ||
    getClientAuthMode() === "password"
  );
}
