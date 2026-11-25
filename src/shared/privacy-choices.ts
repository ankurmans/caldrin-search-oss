import { hostedOrigin } from "@/shared/hosted-origin";

export type PrivacyChoices = {
  /** PostHog product analytics in the app: events, errors and masked
   *  session recordings. The website's visit statistics are cookieless and
   *  not covered here. */
  analytics: boolean;
};

const PRIVACY_COOKIE = "caldrin_search_privacy";
const PRIVACY_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

// For visitors from these countries nothing optional runs until they opt in.
// Everywhere else optional tracking is on until the visitor opts out. EEA
// (EU + Iceland, Liechtenstein, Norway), UK and Switzerland. The second line
// is EU regions that report their own code (French overseas regions, Åland),
// then Gibraltar and the Crown Dependencies, which follow GDPR-style rules.
const OPT_IN_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE", "IS", "LI", "NO", "GB", "CH",
  "RE", "GP", "MQ", "GF", "YT", "MF", "AX", "GI", "JE", "GG", "IM",
]); // prettier-ignore

/** `country` is Cloudflare's CF-IPCountry. Unknown or anonymized (XX, T1)
 *  locations get the opt-in treatment. */
export function requiresOptIn(country: string | null | undefined): boolean {
  if (!country || country.length !== 2) return true;
  if (country === "XX" || country === "T1") return true;
  return OPT_IN_COUNTRIES.has(country.toUpperCase());
}

export function defaultPrivacyChoices(optIn: boolean): PrivacyChoices {
  return { analytics: !optIn };
}

/** Saved choices from a Cookie header or `document.cookie`, or null when the
 *  visitor hasn't chosen yet (or the cookie is unreadable). */
export function readPrivacyCookie(
  cookieHeader: string | null | undefined,
): PrivacyChoices | null {
  const raw = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PRIVACY_COOKIE}=`))
    ?.slice(PRIVACY_COOKIE.length + 1);
  // Format: "a1". Cookies saved under older versions carry extra ".d0.m0"
  // flags after it, which are ignored.
  const match = /^a([01])(?:\.d[01])?(?:\.m[012])?$/.exec(raw ?? "");
  if (!match) return null;
  return { analytics: match[1] === "1" };
}

/** Choices that apply right now: the saved ones, or the region default when
 *  the visitor hasn't made any. */
export function effectivePrivacyChoices(args: {
  saved: PrivacyChoices | null;
  optIn: boolean;
}): PrivacyChoices {
  return args.saved ?? defaultPrivacyChoices(args.optIn);
}

// ---- Browser helpers ----

function cookieDomainAttribute(): string {
  if (!hostedOrigin) return "";
  const domain = new URL(hostedOrigin).hostname.split(".").slice(1).join(".");
  const host = location.hostname;
  return host === domain || host.endsWith(`.${domain}`)
    ? `; Domain=${domain}`
    : "";
}

function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}${cookieDomainAttribute()}`;
}

const flag = (value: boolean) => (value ? "1" : "0");

export function savePrivacyChoices(choices: PrivacyChoices) {
  writeCookie(
    PRIVACY_COOKIE,
    `a${flag(choices.analytics)}`,
    PRIVACY_COOKIE_MAX_AGE_SECONDS,
  );
  window.dispatchEvent(new Event(PRIVACY_CHOICES_CHANGED_EVENT));
}

export const PRIVACY_CHOICES_CHANGED_EVENT =
  "caldrin-search:privacy-choices-changed";
