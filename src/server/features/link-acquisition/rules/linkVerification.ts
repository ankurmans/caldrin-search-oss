import * as cheerio from "cheerio";

export type PageLink = {
  href: string;
  anchor: string;
  rel: string[];
  context: string;
  hidden: boolean;
};

type PageReading = {
  canonical: string | null;
  noindex: boolean;
  links: PageLink[];
};

const TRACKING = /^(utm_|gclid$|fbclid$|mc_|ref$)/i;
const CONTEXT_CHARS = 160;

/**
 * A URL as a person would compare it: scheme, www, fragment, default port,
 * trailing slash and tracking parameters do not make two addresses different.
 */
export function comparableUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const params = [...url.searchParams.entries()].filter(
      ([key]) => !TRACKING.test(key),
    );
    params.sort(([a], [b]) => a.localeCompare(b));
    const query = params.map(([k, v]) => `${k}=${v}`).join("&");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path === "/" ? "" : path}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

export function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Reads the hyperlinks of a fetched page. Only real `<a href>` elements count:
 * text that merely contains a URL is not a link. A link hidden with the
 * `hidden` attribute or an inline display:none is reported as hidden.
 */
export function readPage(html: string, finalUrl: string): PageReading {
  const $ = cheerio.load(html);
  const baseHref = $("base[href]").first().attr("href");
  let base = finalUrl;
  if (baseHref) {
    try {
      base = new URL(baseHref, finalUrl).toString();
    } catch {
      base = finalUrl;
    }
  }
  const canonicalHref = $('link[rel~="canonical"]').first().attr("href");
  let canonical: string | null = null;
  if (canonicalHref) {
    try {
      canonical = new URL(canonicalHref, base).toString();
    } catch {
      canonical = null;
    }
  }
  const robots = $('meta[name="robots" i]').first().attr("content") ?? "";
  const links: PageLink[] = [];
  $("a[href]").each((_, element) => {
    const node = $(element);
    const raw = node.attr("href")?.trim();
    if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel):/i.test(raw)) {
      return;
    }
    let href: string;
    try {
      href = new URL(raw, base).toString();
    } catch {
      return;
    }
    const anchor = node.text().replace(/\s+/g, " ").trim();
    const block = node.closest("p,li,td,div,section,article").first();
    const text = block.text().replace(/\s+/g, " ").trim();
    const at = anchor ? text.indexOf(anchor) : -1;
    const context =
      at >= 0
        ? text
            .slice(
              Math.max(0, at - CONTEXT_CHARS),
              at + anchor.length + CONTEXT_CHARS,
            )
            .trim()
        : text.slice(0, CONTEXT_CHARS * 2);
    const style = (node.attr("style") ?? "").replace(/\s+/g, "").toLowerCase();
    const hidden =
      node.attr("hidden") !== undefined ||
      style.includes("display:none") ||
      style.includes("visibility:hidden");
    links.push({
      href,
      anchor,
      rel: (node.attr("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean),
      context,
      hidden,
    });
  });
  return { canonical, noindex: /noindex/i.test(robots), links };
}

/** The links on a page that point at exactly the expected destination. */
export function linksTo(reading: PageReading, expected: string) {
  const want = comparableUrl(expected);
  return reading.links.filter(
    (link) => want !== null && comparableUrl(link.href) === want,
  );
}

/** Links to the expected destination's site that are not the expected page. */
export function linksToSite(reading: PageReading, expected: string) {
  const host = hostOf(expected);
  const want = comparableUrl(expected);
  return reading.links.filter(
    (link) =>
      host !== null &&
      hostOf(link.href) === host &&
      comparableUrl(link.href) !== want,
  );
}

export type CheckOutcome =
  | "confirmed"
  | "link_missing"
  | "destination_changed"
  | "attributes_changed"
  | "page_gone"
  | "unverifiable";

type Attributes = {
  isNofollow: boolean;
  isSponsored: boolean;
  isUgc: boolean;
};

export function attributesOf(link: PageLink): Attributes {
  return {
    isNofollow: link.rel.includes("nofollow"),
    isSponsored: link.rel.includes("sponsored"),
    isUgc: link.rel.includes("ugc"),
  };
}

/**
 * What a check found, given the last check that confirmed the link. A link
 * that is present but different from what was confirmed is reported as
 * changed, not as confirmed, so the change shows in the history.
 */
export function decideOutcome(input: {
  found: PageLink | null;
  otherSiteLinks: PageLink[];
  previous: { href: string | null; attributes: Attributes } | null;
}): CheckOutcome {
  const { found, previous } = input;
  if (found) {
    if (found.hidden) return "link_missing";
    if (
      previous?.href &&
      comparableUrl(previous.href) !== comparableUrl(found.href)
    ) {
      return "destination_changed";
    }
    const now = attributesOf(found);
    if (
      previous &&
      (previous.attributes.isNofollow !== now.isNofollow ||
        previous.attributes.isSponsored !== now.isSponsored ||
        previous.attributes.isUgc !== now.isUgc)
    ) {
      return "attributes_changed";
    }
    return "confirmed";
  }
  if (input.otherSiteLinks.length > 0 && previous?.href) {
    return "destination_changed";
  }
  return "link_missing";
}
