import type { BacklinksItem } from "@/server/lib/dataforseo";
import {
  normaliseDomain,
  providerDate,
} from "@/server/features/site-explorer/rules/gapMerge";
import type { LinkEvidenceInput } from "../repositories/LinkGapRepository";

function date(value: string | null | undefined, fallback: string) {
  return value ? providerDate(value, fallback) : null;
}

/**
 * One provider backlink as evidence. The provider's own fields are kept as
 * reported; a field it did not send stays null, so a missing anchor or
 * context is never filled in.
 */
export function evidenceFromBacklink(
  item: BacklinksItem,
  context: {
    projectId: string;
    competitorDomain: string | null;
    collectedAt: string;
  },
): LinkEvidenceInput | null {
  const urlFrom = item.url_from;
  const urlTo = item.url_to;
  const referringDomain = item.domain_from
    ? normaliseDomain(item.domain_from)
    : null;
  if (!urlFrom || !urlTo || !referringDomain) return null;
  const rel = (item.rel_attributes ?? item.attributes ?? []).map((value) =>
    value.toLowerCase(),
  );
  return {
    projectId: context.projectId,
    referringDomain,
    competitorDomain: context.competitorDomain,
    urlFrom,
    urlTo,
    anchor: item.anchor ?? null,
    textBefore: item.text_pre ?? null,
    textAfter: item.text_post ?? null,
    semanticLocation: item.semantic_location ?? null,
    itemType: item.item_type ?? null,
    isDofollow: item.dofollow ?? null,
    isNofollow: rel.includes("nofollow") || item.dofollow === false,
    isSponsored: rel.includes("sponsored"),
    isUgc: rel.includes("ugc"),
    pageTitle: item.page_from_title ?? null,
    pageLanguage: item.page_from_language ?? null,
    platformType: item.domain_from_platform_type?.[0] ?? null,
    domainRank: item.domain_from_rank ?? null,
    pageRank: item.page_from_rank ?? null,
    spamScore: item.backlink_spam_score ?? item.backlinks_spam_score ?? null,
    firstSeen: date(item.first_seen, context.collectedAt),
    lastSeen: date(item.last_seen ?? item.last_visited, context.collectedAt),
    lostDate: date(item.lost_date, context.collectedAt),
    targetStatusCode: item.url_to_status_code ?? null,
    targetRedirect: item.url_to_redirect_target ?? null,
    source: "dataforseo_backlinks",
    collectedAt: context.collectedAt,
  };
}
