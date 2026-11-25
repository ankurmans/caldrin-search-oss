import { AiCrawlerRepository as repo } from "../repositories/AiCrawlerRepository";
import { isCrawlableUrl } from "@/server/lib/audit/url-policy";
import { publicFetch } from "@/server/lib/public-fetch";
import { detectSiteHost } from "@/shared/site-host";
import { proxiedByCloudflare } from "@/server/lib/site-host-dns";

const TIMEOUT_MS = 8_000;
const MAX_HOPS = 2;

/**
 * Where the project's site is hosted, from its DNS and the headers of its home
 * page. The redirect chain is read too, since a site that sends the bare domain on to
 * www puts its host's headers on both answers. Never throws: a site that does
 * not answer is "unknown".
 */
export async function detectProjectHost(projectId: string) {
  const domain = await repo.getProjectDomain(projectId);
  if (!domain) return { domain: null, host: "unknown" as const };
  const headers = new Headers();
  let url = `https://${domain}/`;
  const deadline = Date.now() + TIMEOUT_MS;
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const response = await publicFetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      await response.body?.cancel();
      for (const [name, value] of response.headers)
        if (!headers.has(name)) headers.set(name, value);
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) break;
      const next = new URL(location, url).toString();
      if (!isCrawlableUrl(next)) break;
      url = next;
    }
  } catch (error) {
    console.warn("Failed to read site headers:", error);
  }
  return {
    domain,
    host: detectSiteHost(headers, await proxiedByCloudflare(domain)),
  };
}
