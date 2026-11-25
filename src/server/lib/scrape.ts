import { hostedOrigin } from "@/shared/hosted-origin";
// Lightweight, dependency-free site reading shared by the chat agents
// (onboarding + SAM): discover URLs from the sitemap (falling back to the
// homepage) and extract readable text from each page via plain fetch. This is
// enough to let the model infer what a site does. JS-heavy sites degrade
// gracefully (less text); a Browser Rendering upgrade can slot in behind this
// same interface later.

import { publicFetch } from "@/server/lib/public-fetch";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { RenderedPageService } from "@/server/lib/audit/rendered-page";
import { getTinyfishFetch } from "@/server/lib/provider-access";
import type { RenderUsage } from "@/shared/audit-rendering";

const MAX_PAGES = 5;
const PER_PAGE_CHAR_LIMIT = 4000;
const FETCH_TIMEOUT_MS = 10_000;
// Covers chains like https://apex -> http://www -> https://www.
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2_000_000;
const USER_AGENT = `Caldrin-Onboarding/1.0${hostedOrigin ? ` (+${hostedOrigin})` : ""}`;

type ScrapedPage = {
  url: string;
  title: string | null;
  text: string;
};

type SiteReadResult = {
  pages: ScrapedPage[];
  /** True when we couldn't read any page (blocked, offline, etc.). */
  blocked: boolean;
};

// Bounded read: accumulate up to MAX_RESPONSE_BYTES regardless of whether
// content-length is present (chunked / CDN responses often omit it).
export async function readBoundedText(
  response: Response,
): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let result = "";
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

/**
 * With `tinyfishUsage`, a page the plain fetch can't read is read through
 * Context, because many sites throttle or block Cloudflare Workers (Shopify's
 * edge, bot protection). Its credits are added to `tinyfishUsage` for the caller
 * to bill. A missing page (404/410) is not retried there.
 */
async function fetchText(
  url: string,
  tinyfishUsage?: RenderUsage,
): Promise<string | null> {
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await publicFetch(current, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
        // Manual redirects so we can re-validate each hop against the SSRF guard;
        // redirect:"follow" would let a 30x to an internal host bypass it.
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) return await readBoundedText(response);
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410) return null;
        break;
      }
      // Re-validates host, blocks private IPs, and does DoH DNS resolution.
      // A blocked or invalid destination is not sent to Context either: it
      // follows redirects itself and would reach the blocked host.
      try {
        current = await normalizeAndValidateStartUrl(
          new URL(location, current).toString(),
        );
      } catch {
        return null;
      }
    }
  } catch {
    // Timeouts, TLS and network errors fall through to Context.
  }
  if (!tinyfishUsage) return null;
  const tinyfishFetch = await getTinyfishFetch();
  if (!tinyfishFetch) return null;
  try {
    return (
      await RenderedPageService.renderPage(current, {
        tinyfishFetch,
        usage: tinyfishUsage,
      })
    ).html;
  } catch {
    return null;
  }
}

/**
 * Reads a sitemap body. Relative and protocol-relative <loc> entries are
 * resolved against the origin and only same-origin entries are kept. A sitemap
 * index lists other sitemaps, not pages, so its entries come back as `sitemaps`.
 */
function parseSitemap(
  xml: string,
  origin: string,
): { urls: string[]; sitemaps: string[] } {
  const isIndex = /<sitemapindex\b/i.test(xml);
  const urls: string[] = [];
  const sitemaps: string[] = [];
  const regex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    let resolved: string;
    try {
      resolved = new URL(match[1], origin).toString();
    } catch {
      continue;
    }
    if (!resolved.startsWith(origin)) continue;
    if (isIndex || resolved.endsWith(".xml")) sitemaps.push(resolved);
    else urls.push(resolved);
  }
  return { urls, sitemaps };
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1].trim()) : null;
}

// Below this many characters an <article> or <main> is more likely a widget
// than the page's content, so the whole page is read instead.
const MIN_CONTENT_CHARS = 500;

function stripTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips scripts, styles, navigation, footers and tags and collapses whitespace
 * into readable text. A page's <article> or <main> is preferred, so a long menu
 * does not use up the character limit before the content starts.
 */
function htmlToText(html: string): string {
  const content = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html);
  const inner = content ? stripTags(content[2]) : "";
  const text = inner.length >= MIN_CONTENT_CHARS ? inner : stripTags(html);
  return decodeEntities(text);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Fetches one (already-validated) URL and shapes it as a page, or null if it
 * couldn't be read or yielded no text. */
async function scrapePage(
  url: string,
  tinyfishUsage: RenderUsage | undefined,
  charLimit: number,
): Promise<ScrapedPage | null> {
  const html = await fetchText(url, tinyfishUsage);
  if (!html) {
    return null;
  }
  const text = htmlToText(html).slice(0, charLimit);
  if (text.length === 0) {
    return null;
  }
  // Extracted titles and shortened text can retain their entire source string
  // in V8. Detach them before pages accumulate in results or chat transcripts.
  return structuredClone({ url, title: extractTitle(html), text });
}

/**
 * Reads a specific list of page URLs as plain text — used when the caller names
 * exact pages (the user's own or a competitor's) rather than asking us to
 * discover a site. Each URL is independently run through the SSRF guard, so a
 * blocked or unreachable URL is skipped rather than failing the batch.
 * With `tinyfishUsage`, pages the plain fetch can't read are read through TinyFish.
 */
export async function readPages(
  urls: string[],
  maxPages: number = MAX_PAGES,
  tinyfishUsage?: RenderUsage,
  charLimit: number = PER_PAGE_CHAR_LIMIT,
): Promise<SiteReadResult> {
  const pages: ScrapedPage[] = [];
  for (const rawUrl of urls.slice(0, maxPages)) {
    let url: string;
    try {
      // Re-validates host, blocks private/metadata IPs, does DoH DNS resolution.
      url = await normalizeAndValidateStartUrl(rawUrl);
    } catch {
      continue; // blocked or unparseable URL
    }
    const page = await scrapePage(url, tinyfishUsage, charLimit);
    if (page) {
      pages.push(page);
    }
  }

  return { pages, blocked: pages.length === 0 };
}

const MAX_SITEMAP_FILES = 30;
const SITEMAP_DEPTH = 2;

/** Sitemap addresses a site's robots.txt declares. */
async function robotsSitemaps(origin: string): Promise<string[]> {
  const robots = await fetchText(`${origin}/robots.txt`);
  if (!robots) return [];
  const found: string[] = [];
  for (const line of robots.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (!match) continue;
    try {
      found.push(new URL(match[1], origin).toString());
    } catch {
      // Skip a malformed line.
    }
  }
  return found;
}

/**
 * Lists a site's page URLs without reading them: the homepage plus what its
 * sitemaps declare, capped at `limit`. Follows sitemap indexes (the sitemaps
 * robots.txt names, or /sitemap.xml) so a site that splits its sitemap into
 * files is listed in full, not just its first file. Lets an agent see what a
 * site has and choose which pages to read (readPages) instead of blindly
 * taking the first N.
 */
export async function discoverSiteUrls(
  domain: string,
  limit: number,
): Promise<{ urls: string[]; blocked: boolean }> {
  let rootUrl: string;
  try {
    rootUrl = await normalizeAndValidateStartUrl(domain);
  } catch {
    // Blocked (private/metadata host) or unparseable domain — nothing to list.
    return { urls: [], blocked: true };
  }
  const origin = new URL(rootUrl).origin;

  const seen = new Set<string>();
  const discovered: string[] = [];
  let queue = [
    ...new Set([`${origin}/sitemap.xml`, ...(await robotsSitemaps(origin))]),
  ];
  for (
    let depth = 0;
    depth <= SITEMAP_DEPTH && queue.length > 0 && discovered.length < limit;
    depth++
  ) {
    const files = queue
      .filter((file) => !seen.has(file))
      .slice(0, MAX_SITEMAP_FILES - seen.size);
    files.forEach((file) => seen.add(file));
    const bodies = await Promise.all(files.map((file) => fetchText(file)));
    queue = [];
    for (const body of bodies) {
      if (!body) continue;
      const parsed = parseSitemap(body, origin);
      discovered.push(...parsed.urls);
      queue.push(...parsed.sitemaps);
    }
  }
  const urls = [rootUrl, ...new Set(discovered.filter((u) => u !== rootUrl))];
  return { urls: urls.slice(0, limit), blocked: false };
}

/**
 * Discovers a site's representative URLs (homepage + sitemap) and reads them.
 * Just URL discovery on top of readPages, which does the validated fetching.
 */
export async function readSite(
  domain: string,
  maxPages: number = MAX_PAGES,
  tinyfishUsage?: RenderUsage,
): Promise<SiteReadResult> {
  const discovered = await discoverSiteUrls(domain, maxPages);
  if (discovered.blocked) {
    return { pages: [], blocked: true };
  }
  const site = await readPages(discovered.urls, maxPages, tinyfishUsage);
  const root = new URL(discovered.urls[0]);
  if (!site.blocked || root.hostname.startsWith("www.")) return site;
  // Some sites only serve their www host (e.g. the bare domain's TLS
  // certificate is missing), so retry there before giving up.
  root.hostname = `www.${root.hostname}`;
  // The setter ignores invalid hosts, so IP literals keep their original host.
  if (!root.hostname.startsWith("www.")) return site;
  return readSite(root.toString(), maxPages, tinyfishUsage);
}
