import { firstBy, sort } from "remeda";
import type { DomainIntersectionItem } from "@/server/lib/dataforseo/backlinksIntersection";
import {
  normaliseDomain,
  providerDate,
} from "@/server/features/site-explorer/rules/gapMerge";

/**
 * One provider read. `competitors` lists the targets in the order they were
 * sent: the provider keys each entry by that position, "1" for the first.
 */
export type LinkGapRead = {
  competitors: string[];
  items: DomainIntersectionItem[];
};

export type CompetitorLinkStats = {
  competitorDomain: string;
  backlinks: number | null;
  referringPages: number | null;
  nofollowPages: number | null;
  domainRank: number | null;
  spamScore: number | null;
  firstSeen: string | null;
  lostDate: string | null;
  topPlatform: string | null;
  topPlacement: string | null;
};

export type MergedLinkCandidate = {
  referringDomain: string;
  competitorCount: number;
  domainRank: number | null;
  spamScore: number | null;
  firstSeen: string | null;
  lostDate: string | null;
  competitors: CompetitorLinkStats[];
};

function topKey(counts: Record<string, number | null> | null | undefined) {
  const entries = Object.entries(counts ?? {}).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && entry[0] !== "",
  );
  return firstBy(entries, [([, count]) => count, "desc"])?.[0] ?? null;
}

function date(value: string | null | undefined, fallback: string) {
  return value ? providerDate(value, fallback) : null;
}

function maxOrNull(values: Array<number | null>) {
  const numbers = values.filter((v): v is number => v !== null);
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

/**
 * Turns provider intersection reads into one candidate per referring domain.
 *
 * The provider's `target` inside each entry is the referring domain; the key
 * of the entry says which competitor it links to. The user's own site is
 * dropped even when the provider returns it (the provider's exclude list only
 * removes domains that link to the excluded target, so the target itself can
 * still appear as a referrer), and so is any compared competitor.
 */
export function mergeLinkGapReads(
  reads: LinkGapRead[],
  options: { own: string; competitors: string[]; runAt: string },
): MergedLinkCandidate[] {
  const blocked = new Set([options.own, ...options.competitors]);
  const byDomain = new Map<string, Map<string, CompetitorLinkStats>>();

  for (const read of reads) {
    for (const item of read.items) {
      for (const [key, entry] of Object.entries(item.domain_intersection)) {
        const competitor = read.competitors[Number(key) - 1];
        const referrer = entry.target ? normaliseDomain(entry.target) : null;
        if (!competitor || !referrer) continue;
        if (
          blocked.has(referrer) ||
          referrer.endsWith(`.${options.own}`) ||
          referrer === competitor
        ) {
          continue;
        }
        const stats =
          byDomain.get(referrer) ?? new Map<string, CompetitorLinkStats>();
        // The same competitor can come back from a shared and a single read;
        // they describe the same links, so the first one stays.
        if (!stats.has(competitor)) {
          stats.set(competitor, {
            competitorDomain: competitor,
            backlinks: entry.backlinks ?? null,
            referringPages: entry.referring_pages ?? null,
            nofollowPages: entry.referring_pages_nofollow ?? null,
            domainRank: entry.rank ?? null,
            spamScore: entry.backlinks_spam_score ?? null,
            firstSeen: date(entry.first_seen, options.runAt),
            lostDate: date(entry.lost_date, options.runAt),
            topPlatform: topKey(entry.referring_links_platform_types),
            topPlacement: topKey(entry.referring_links_semantic_locations),
          });
        }
        byDomain.set(referrer, stats);
      }
    }
  }

  const merged = [...byDomain.entries()].map(([referringDomain, stats]) => {
    const competitors = [...stats.values()];
    return {
      referringDomain,
      competitorCount: competitors.length,
      domainRank: maxOrNull(competitors.map((c) => c.domainRank)),
      spamScore: maxOrNull(competitors.map((c) => c.spamScore)),
      firstSeen:
        firstBy(
          competitors.filter((c) => c.firstSeen),
          (c) => c.firstSeen ?? "",
        )?.firstSeen ?? null,
      lostDate:
        firstBy(
          competitors.filter((c) => c.lostDate),
          [(c) => c.lostDate ?? "", "desc"],
        )?.lostDate ?? null,
      competitors,
    };
  });
  return sort(merged, (a, b) =>
    b.competitorCount !== a.competitorCount
      ? b.competitorCount - a.competitorCount
      : (b.domainRank ?? -1) - (a.domainRank ?? -1),
  );
}
