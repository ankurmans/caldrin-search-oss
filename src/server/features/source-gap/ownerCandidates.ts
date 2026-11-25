import {
  GscNotConnectedError,
  GscService,
} from "@/server/features/gsc/services/GscService";
import { discoverSiteUrls } from "@/server/lib/scrape";
import { isOnDomain } from "@/server/features/citation-gaps/citationSourceRules";
import type { OwnerInput } from "./ownerPageSelector";
import { SourceGapRepository } from "./sourceGapRepository";

const SITEMAP_LIMIT = 3000;

/**
 * Pages of the project's own site that might be the page for a prompt: the
 * sitemap, the newest finished crawl, and Search Console pages with the queries
 * that reached them. A source that is not connected is skipped, not invented.
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export async function loadOwnerInputs(
  projectId: string,
  domain: string,
): Promise<{ inputs: OwnerInput[]; notes: string[]; complete: boolean }> {
  const byUrl = new Map<string, OwnerInput>();
  const notes: string[] = [];
  const add = (input: OwnerInput) => {
    const host = hostOf(input.url);
    if (!host || !isOnDomain(host, domain)) return;
    const kept = byUrl.get(input.url);
    byUrl.set(input.url, {
      url: input.url,
      title: input.title ?? kept?.title,
      gscQueries: [...(kept?.gscQueries ?? []), ...(input.gscQueries ?? [])],
      discoveredVia: [
        ...new Set([
          ...(kept?.discoveredVia ?? []),
          ...(input.discoveredVia ?? []),
        ]),
      ],
    });
  };

  const [pages, sitemap, gsc] = await Promise.all([
    SourceGapRepository.latestAuditPages(projectId),
    discoverSiteUrls(domain, SITEMAP_LIMIT).catch(() => ({
      urls: [],
      blocked: true,
    })),
    GscService.getPerformance({
      projectId,
      dimensions: ["query", "page"],
      dateRange: "last_28_days",
      rowLimit: 1000,
    }).catch((error: unknown) => {
      if (!(error instanceof GscNotConnectedError))
        notes.push("Search Console could not be read for page candidates.");
      return null;
    }),
  ]);
  for (const page of pages)
    if (hostOf(page.url)) add({ ...page, discoveredVia: ["crawl"] });
  if (pages.length === 0) notes.push("No finished site crawl was found.");
  for (const url of sitemap.urls)
    if (hostOf(url)) add({ url, discoveredVia: ["sitemap"] });
  // A page that was never listed cannot be found, so say when the list may be short.
  let complete = true;
  if (sitemap.blocked) {
    complete = false;
    notes.push("The sitemap could not be read.");
  } else if (sitemap.urls.length >= SITEMAP_LIMIT) {
    complete = false;
    notes.push(
      `The sitemap lists more than ${SITEMAP_LIMIT} pages, so only the first ${SITEMAP_LIMIT} were checked.`,
    );
  } else if (sitemap.urls.length <= 1 && pages.length === 0) {
    complete = false;
    notes.push(
      "The sitemap listed no pages and there is no finished site crawl, so the site's pages may not all have been checked.",
    );
  }
  for (const row of gsc?.rows ?? []) {
    const [query, page] = row.keys ?? [];
    if (query && page && hostOf(page) && row.impressions > 0)
      add({
        url: page,
        gscQueries: [query],
        discoveredVia: ["search_console"],
      });
  }
  if (!gsc)
    notes.push(
      "Search Console is not connected, so query overlap was not used.",
    );
  return { inputs: [...byUrl.values()], notes, complete };
}
