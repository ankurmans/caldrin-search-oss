import type { DomainIntersectionItem } from "@/server/lib/dataforseo/labs";
import { isValidDomainHost } from "@/shared/researchScope";

// One competitor read: the keywords that competitor ranks for, compared with
// the target. "missing" reads are the ones the target does not rank for;
// "outranked" reads are the shared ones, where both sides carry a position.
export type GapRead = {
  competitorDomain: string;
  kind: "missing" | "outranked";
  items: DomainIntersectionItem[];
};

export type GapPosition = {
  competitorDomain: string;
  position: number;
  url: string | null;
  traffic: number | null;
};

export type MergedGapRow = {
  keyword: string;
  kind: "missing" | "outranked";
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  intent: string | null;
  competitorCount: number;
  bestPosition: number;
  bestDomain: string;
  bestUrl: string | null;
  bestTraffic: number | null;
  targetPosition: number | null;
  targetUrl: string | null;
  observedAt: string;
  positions: GapPosition[];
};

// "2026-10-03 05:42:11 +00:00" is the provider's format; anything unparseable
// falls back to the run time rather than inventing a date.
export function providerDate(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) return fallback;
  const parsed = new Date(value.replace(" +00:00", "Z").replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

// Hostname without protocol, www or path, lower-cased. Subfolder and URL
// targets are not supported by the provider's domain-level comparison, so the
// caller decides what to do with a path; this returns only the host.
export function normaliseDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return null;
  const withoutProtocol = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = withoutProtocol.split(/[/?#]/)[0]?.replace(/^www\./, "") ?? "";
  const bare = host.split("@").pop()?.split(":")[0] ?? "";
  // A fake TLD would come back from the provider as an opaque, charged error.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
    bare,
  ) && isValidDomainHost(bare)
    ? bare
    : null;
}

type Part = {
  keyword: string;
  position: GapPosition;
  targetPosition: number | null;
  targetUrl: string | null;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  intent: string | null;
  observedAt: string;
};

function parts(read: GapRead, runAt: string): Part[] {
  const out: Part[] = [];
  for (const item of read.items) {
    const keyword = item.keyword_data?.keyword?.trim().toLowerCase();
    const competitor = item.first_domain_serp_element;
    const position = competitor?.rank_group ?? competitor?.rank_absolute;
    if (!keyword || position == null) continue;
    const target = item.second_domain_serp_element;
    const targetPosition = target?.rank_group ?? target?.rank_absolute ?? null;
    // An "outranked" row only counts when the competitor is ahead.
    if (read.kind === "outranked") {
      if (targetPosition === null || position >= targetPosition) continue;
    }
    const info = item.keyword_data?.keyword_info;
    out.push({
      keyword,
      position: {
        competitorDomain: read.competitorDomain,
        position,
        url: competitor?.url ?? null,
        traffic: competitor?.etv ?? null,
      },
      targetPosition: read.kind === "outranked" ? targetPosition : null,
      targetUrl: read.kind === "outranked" ? (target?.url ?? null) : null,
      searchVolume: info?.search_volume ?? null,
      keywordDifficulty:
        item.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
      cpc: info?.cpc ?? null,
      intent: item.keyword_data?.search_intent_info?.main_intent ?? null,
      observedAt: providerDate(info?.last_updated_time, runAt),
    });
  }
  return out;
}

// Combines every competitor read into one row per keyword. A keyword the
// target ranks for is "outranked" (or dropped, when no competitor is ahead);
// otherwise it is "missing". Missing values stay null, never zero.
export function mergeGapReads(reads: GapRead[], runAt: string): MergedGapRow[] {
  const byKeyword = new Map<string, MergedGapRow>();
  for (const part of reads.flatMap((read) => parts(read, runAt))) {
    const existing = byKeyword.get(part.keyword);
    if (!existing) {
      byKeyword.set(part.keyword, {
        keyword: part.keyword,
        kind: part.targetPosition === null ? "missing" : "outranked",
        searchVolume: part.searchVolume,
        keywordDifficulty: part.keywordDifficulty,
        cpc: part.cpc,
        intent: part.intent,
        competitorCount: 1,
        bestPosition: part.position.position,
        bestDomain: part.position.competitorDomain,
        bestUrl: part.position.url,
        bestTraffic: part.position.traffic,
        targetPosition: part.targetPosition,
        targetUrl: part.targetUrl,
        observedAt: part.observedAt,
        positions: [part.position],
      });
      continue;
    }
    if (
      existing.positions.some(
        (p) => p.competitorDomain === part.position.competitorDomain,
      )
    ) {
      continue;
    }
    existing.positions.push(part.position);
    existing.competitorCount = existing.positions.length;
    existing.searchVolume ??= part.searchVolume;
    existing.keywordDifficulty ??= part.keywordDifficulty;
    existing.cpc ??= part.cpc;
    existing.intent ??= part.intent;
    if (part.targetPosition !== null && existing.targetPosition === null) {
      existing.kind = "outranked";
      existing.targetPosition = part.targetPosition;
      existing.targetUrl = part.targetUrl;
    }
    if (part.position.position < existing.bestPosition) {
      existing.bestPosition = part.position.position;
      existing.bestDomain = part.position.competitorDomain;
      existing.bestUrl = part.position.url;
      existing.bestTraffic = part.position.traffic;
    }
  }
  return [...byKeyword.values()];
}
