import { crawlerPageDiagnostics } from "./crawlerPageDiagnostics";
import { sortBy } from "remeda";
import { AiCrawlerRepository as repo } from "../repositories/AiCrawlerRepository";
import { reusableCloudflareZone } from "./aiCrawlerCloudflare";
import { AI_BOTS } from "@/shared/ai-bots";
import type { CrawlerActivityInput } from "@/types/schemas/ai-crawlers";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Visits that claimed to be an AI crawler, from the project's Cloudflare zone
 * analytics or its own Worker snippet. Only what that source saw: no source
 * means no data, which is not the same as no visits.
 */
const sum = <T>(items: T[], hits: (item: T) => number) =>
  items.reduce((total, item) => total + hits(item), 0);

export async function getCrawlerActivity(
  input: CrawlerActivityInput,
  site?: string | null,
  // Projects whose Cloudflare token may be offered. Callers without a member
  // in hand offer none.
  borrowableProjectIds: string[] | null = [],
) {
  const [setup, cloudflare, reusableZone] = await Promise.all([
    repo.getKey(input.projectId),
    repo.getCloudflare(input.projectId),
    reusableCloudflareZone(input.projectId, borrowableProjectIds),
  ]);
  const sinceDay = new Date(Date.now() - input.days * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const rows =
    setup || cloudflare ? await repo.listHits(input.projectId, sinceDay) : [];

  const bots = sortBy(
    AI_BOTS.flatMap((bot) => {
      const mine = rows.filter((r) => r.bot === bot.token);
      if (!mine.length) return [];
      return [
        {
          ...bot,
          hits: sum(mine, (r) => r.hits),
          errorHits: sum(
            mine.filter((r) => r.statusClass >= 4),
            (r) => r.hits,
          ),
          lastDay:
            mine.map((r) => r.day).reduce((a, b) => (b > a ? b : a)) ?? null,
        },
      ];
    }),
    [(bot) => bot.hits, "desc"],
  );
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.hits);
  const byPath = new Map<string, number>();
  for (const r of rows) byPath.set(r.path, (byPath.get(r.path) ?? 0) + r.hits);

  return {
    days: input.days,
    source: cloudflare
      ? ("cloudflare" as const)
      : setup
        ? ("snippet" as const)
        : null,
    reusableZone: cloudflare ? null : reusableZone,
    cloudflare: cloudflare
      ? {
          zoneName: cloudflare.zoneName,
          lastSyncedAt: cloudflare.lastSyncedAt,
          lastError: cloudflare.lastError,
        }
      : null,
    lastVisitSeenAt: setup?.lastUsedAt ?? null,
    totalHits: sum(rows, (r) => r.hits),
    bots,
    daily: sortBy(
      [...byDay].map(([day, hits]) => ({ day, hits })),
      (d) => d.day,
    ),
    topPaths: sortBy(
      [...byPath].map(([path, hits]) => ({ path, hits })),
      [(p) => p.hits, "desc"],
    ).slice(0, 25),
    pathDiagnostics:
      site && (setup || cloudflare)
        ? await crawlerPageDiagnostics(input, site, rows)
        : [],
    caveat: cloudflare
      ? "Counted from user agents that claim to be these crawlers; the claim is not checked against the operators' IP ranges. Cloudflare samples busy zones, so large counts are estimates."
      : "Counted from user agents that claim to be these crawlers; the claim is not checked against the operators' IP ranges. Visits to the snippet's routes only.",
  };
}

const RETENTION_DAYS = 365;

export const pruneCrawlerHits = () =>
  repo.pruneHits(
    new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10),
  );
