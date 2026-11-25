import type { Channel } from "./vocabulary";

export type SourceRule = {
  id: string;
  matchKind: "referrer_host" | "utm_source" | "utm_medium" | "click_id";
  pattern: string;
  channel: Channel;
  sourceLabel: string;
};

type SourceInput = {
  referrerHost?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  clickIdKind?: string | null;
  /** The property's own hosts; a referrer from one of them is a self-referral. */
  ownHosts?: readonly string[];
};

type SourceClass = {
  channel: Channel;
  source: string | null;
  ruleId: string;
};

const AI_HOSTS: Record<string, string> = {
  "chatgpt.com": "ChatGPT",
  "chat.openai.com": "ChatGPT",
  "perplexity.ai": "Perplexity",
  "gemini.google.com": "Gemini",
  "claude.ai": "Claude",
  "copilot.microsoft.com": "Copilot",
  "meta.ai": "Meta AI",
  "chat.deepseek.com": "DeepSeek",
  "deepseek.com": "DeepSeek",
  "chat.mistral.ai": "Le Chat",
  "grok.com": "Grok",
  "poe.com": "Poe",
  "phind.com": "Phind",
  "you.com": "You.com",
};

const SEARCH_HOSTS: Record<string, string> = {
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  yahoo: "Yahoo",
  brave: "Brave Search",
  ecosia: "Ecosia",
  baidu: "Baidu",
  yandex: "Yandex",
  kagi: "Kagi",
  startpage: "Startpage",
  qwant: "Qwant",
};

const SOCIAL_HOSTS: Record<string, string> = {
  "facebook.com": "Facebook",
  "instagram.com": "Instagram",
  "linkedin.com": "LinkedIn",
  "twitter.com": "X",
  "x.com": "X",
  "t.co": "X",
  "reddit.com": "Reddit",
  "youtube.com": "YouTube",
  "tiktok.com": "TikTok",
  "pinterest.com": "Pinterest",
  "news.ycombinator.com": "Hacker News",
  "threads.net": "Threads",
};

const EMAIL_HOSTS = new Set([
  "mail.google.com",
  "outlook.live.com",
  "outlook.office.com",
]);

const PAID_MEDIUMS =
  /^(cpc|ppc|paid|paidsearch|paid-search|paidsocial|paid-social|display|cpm|cpv|retargeting)$/i;

// Click ids a platform adds only to paid clicks. fbclid is left out on
// purpose: Facebook also adds it to ordinary shared links.
const PAID_CLICK_IDS: Record<string, string> = {
  gclid: "Google Ads",
  gbraid: "Google Ads",
  wbraid: "Google Ads",
  msclkid: "Microsoft Advertising",
  ttclid: "TikTok Ads",
  li_fat_id: "LinkedIn Ads",
};

export function normalizeHost(host: string | null | undefined) {
  if (!host) return null;
  const clean = host
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return clean || null;
}

function hostMatches(host: string, pattern: string) {
  return host === pattern || host.endsWith(`.${pattern}`);
}

function lookupHost(host: string, table: Record<string, string>) {
  for (const [pattern, label] of Object.entries(table))
    if (hostMatches(host, pattern)) return label;
  return null;
}

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov"]);

/** The engine whose own domain this is: google.com, www.google.co.uk, search.brave.com. */
function searchEngine(host: string) {
  const parts = host.split(".");
  if (parts.length < 2) return null;
  const secondLast = parts[parts.length - 2] ?? "";
  const base =
    parts.length >= 3 && SECOND_LEVEL.has(secondLast)
      ? parts[parts.length - 3]
      : secondLast;
  return (base && SEARCH_HOSTS[base]) || null;
}

function matchProjectRule(
  rules: readonly SourceRule[],
  values: {
    host: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    clickIdKind: string | null;
  },
): SourceClass | null {
  for (const rule of rules) {
    const value =
      rule.matchKind === "referrer_host"
        ? values.host
        : rule.matchKind === "utm_source"
          ? values.utmSource
          : rule.matchKind === "utm_medium"
            ? values.utmMedium
            : values.clickIdKind;
    if (!value) continue;
    const pattern = rule.pattern.toLowerCase();
    const hit =
      rule.matchKind === "referrer_host"
        ? hostMatches(value, pattern)
        : value === pattern;
    if (hit)
      return {
        channel: rule.channel,
        source: rule.sourceLabel,
        ruleId: rule.id,
      };
  }
  return null;
}

const builtin = (
  channel: Channel,
  source: string | null,
  rule: string,
): SourceClass => ({ channel, source, ruleId: `builtin:${rule}` });

/** Campaign tags and click ids, which say more than a referrer does. */
function classifyTags(
  utmSource: string | null,
  utmMedium: string | null,
  clickIdKind: string | null,
): SourceClass | null {
  const paidClick = clickIdKind ? PAID_CLICK_IDS[clickIdKind] : null;
  if (paidClick) return builtin("paid", paidClick, `click_id:${clickIdKind}`);
  if (utmMedium && PAID_MEDIUMS.test(utmMedium))
    return builtin("paid", utmSource, "utm_medium:paid");
  if (utmMedium === "email" || utmMedium === "newsletter")
    return builtin("email", utmSource, "utm_medium:email");
  if (utmMedium === "outbound" || utmMedium === "cold-email")
    return builtin("outbound", utmSource, "utm_medium:outbound");
  // Assistants that tag their own links (utm_source=chatgpt.com).
  const ai = utmSource ? lookupHost(utmSource, AI_HOSTS) : null;
  return ai ? builtin("ai_referral", ai, "utm_source:ai") : null;
}

function classifyReferrer(host: string): SourceClass {
  const ai = lookupHost(host, AI_HOSTS);
  if (ai) return builtin("ai_referral", ai, "referrer:ai");
  const engine = searchEngine(host);
  if (engine) return builtin("organic_search", engine, "referrer:search");
  const social = lookupHost(host, SOCIAL_HOSTS);
  if (social) return builtin("social", social, "referrer:social");
  if (EMAIL_HOSTS.has(host)) return builtin("email", host, "referrer:email");
  return builtin("referral", host, "referrer:other");
}

/** A campaign tag with no referrer: still worth naming, never guessed beyond the tag. */
function classifyUntaggedSource(
  utmSource: string | null,
  utmMedium: string | null,
): SourceClass {
  const engine = utmSource ? SEARCH_HOSTS[utmSource] : null;
  if (engine && (!utmMedium || utmMedium === "organic"))
    return builtin("organic_search", engine, "utm_source:search");
  const social = utmSource
    ? (lookupHost(utmSource, SOCIAL_HOSTS) ??
      lookupHost(`${utmSource}.com`, SOCIAL_HOSTS))
    : null;
  if (social) return builtin("social", social, "utm_source:social");
  return builtin("referral", utmSource, "utm_tagged");
}

/**
 * Says which channel a recorded source belongs to, and which rule decided it.
 * Project rules run first, then the built-in rules in a fixed order, so the
 * same input always gives the same answer and the rule can be shown to the
 * person looking at the result. Nothing here guesses: an input with no
 * referrer and no campaign tags is direct, and anything unmatched with a
 * referrer is a plain referral.
 */
export function classifySource(
  input: SourceInput,
  projectRules: readonly SourceRule[] = [],
): SourceClass {
  const host = normalizeHost(input.referrerHost);
  const utmSource = input.utmSource?.trim().toLowerCase() || null;
  const utmMedium = input.utmMedium?.trim().toLowerCase() || null;
  const clickIdKind = input.clickIdKind ?? null;

  const own = (input.ownHosts ?? []).map((h) => normalizeHost(h));
  if (host && own.some((o) => o && hostMatches(host, o)))
    return builtin("internal", host, "self_referral");

  return (
    matchProjectRule(projectRules, {
      host,
      utmSource,
      utmMedium,
      clickIdKind,
    }) ??
    classifyTags(utmSource, utmMedium, clickIdKind) ??
    (host ? classifyReferrer(host) : null) ??
    (utmSource || utmMedium
      ? classifyUntaggedSource(utmSource, utmMedium)
      : null) ??
    builtin("direct", null, "no_referrer")
  );
}

/** Whether a user agent looks like an automated client rather than a person. */
export function looksLikeBot(userAgent: string | null | undefined) {
  if (!userAgent) return false;
  return /bot|crawl|spider|slurp|headless|preview|monitor|lighthouse|pingdom|uptime|curl|wget|python-requests|go-http|node-fetch|axios|facebookexternalhit/i.test(
    userAgent,
  );
}
