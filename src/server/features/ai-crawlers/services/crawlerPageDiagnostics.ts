import { sortBy } from "remeda";
import { ownsEditorialUrl } from "@/shared/editorialUrl";
import { SourceIntelligenceRepository as sources } from "@/server/features/source-intelligence/repositories/SourceIntelligenceRepository";
import type { CrawlerActivityInput } from "@/types/schemas/ai-crawlers";
import type { AiCrawlerRepository } from "../repositories/AiCrawlerRepository";

type Hit = Awaited<ReturnType<typeof AiCrawlerRepository.listHits>>[number];
type Row = {
  path: string;
  visits: number;
  errors: number;
  lastDay: string | null;
  citedUrls: Set<string>;
  retrievedUrls: Set<string>;
};

export async function crawlerPageDiagnostics(
  input: CrawlerActivityInput,
  site: string,
  hits: Hit[],
) {
  const filters = { days: input.days, hideDismissed: true };
  const [cited, retrieved] = await Promise.all([
    sources.citedCounts(input.projectId, filters, "url"),
    sources.retrievedCounts(input.projectId, filters, "url"),
  ]);
  const pages = new Map<string, Row>();
  const pageFor = (path: string) => {
    const row = pages.get(path) ?? {
      path,
      visits: 0,
      errors: 0,
      lastDay: null,
      citedUrls: new Set<string>(),
      retrievedUrls: new Set<string>(),
    };
    pages.set(path, row);
    return row;
  };
  for (const hit of hits) {
    if (!hit.path.startsWith("/")) continue;
    const row = pageFor(hit.path);
    row.visits += hit.hits;
    if (hit.statusClass >= 4) row.errors += hit.hits;
    if (!row.lastDay || hit.day > row.lastDay) row.lastDay = hit.day;
  }

  for (const [kind, evidence] of [
    ["citedUrls", cited],
    ["retrievedUrls", retrieved],
  ] as const) {
    for (const row of evidence) {
      if (ownsEditorialUrl(site, row.key)) {
        const url = new URL(row.key);
        pageFor(url.pathname)[kind].add(url.href);
      }
    }
  }

  return sortBy(
    [...pages.values()],
    [(row) => row.errors, "desc"],
    [(row) => row.citedUrls.size, "desc"],
    [(row) => row.retrievedUrls.size, "desc"],
    [(row) => row.visits, "desc"],
    (row) => row.path,
  )
    .slice(0, 50)
    .map((row) => ({
      path: row.path,
      visits: row.visits,
      errors: row.errors,
      lastDay: row.lastDay,
      citedUrls: [...row.citedUrls].slice(0, 10),
      retrievedUrls: [...row.retrievedUrls].slice(0, 10),
    }));
}
