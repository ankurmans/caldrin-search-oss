import { normalizeUrl } from "@/server/lib/audit/url-utils";

const FILE_EXTENSION =
  /\.(pdf|docx?|xlsx?|pptx?|zip|csv|mp3|mp4|mov|png|jpe?g|gif|webp|svg)$/i;

/**
 * The key one cited page is counted under. Tracking parameters, fragments, a
 * leading `www.`, the scheme, a trailing slash and query order do not make a
 * different page, so `http://www.x.com/a/?utm_source=y` and `https://x.com/a`
 * are one source. The canonical tag is applied after the page is read
 * (see `mergeByCanonical`).
 */
export function normalizeSourceUrl(url: string): string | null {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  parsed.protocol = "https:";
  parsed.hostname = parsed.hostname.replace(/^www\./, "");
  if (parsed.pathname.length > 1)
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

export function isFileUrl(url: string): boolean {
  try {
    return FILE_EXTENSION.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** A site's front page: the answer cited the site, not a page on it. */
export function isHomepageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/+$/, "") === "" && !parsed.search;
  } catch {
    return false;
  }
}

/**
 * Pages whose canonical tag names another cited page are the same page. Returns
 * a map from each key to the key it should be counted under.
 */
export function mergeByCanonical(
  pages: { key: string; canonical: string | null }[],
): Map<string, string> {
  const keys = new Set(pages.map((p) => p.key));
  const target = new Map<string, string>();
  for (const page of pages) {
    const canonical = page.canonical
      ? normalizeSourceUrl(page.canonical)
      : null;
    target.set(
      page.key,
      canonical && canonical !== page.key && keys.has(canonical)
        ? canonical
        : page.key,
    );
  }
  return target;
}
