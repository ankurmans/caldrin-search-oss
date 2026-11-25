import { tokenize } from "@/server/features/content/rules/opportunityRules";
import { normaliseDomain } from "@/server/features/site-explorer/rules/gapMerge";
import {
  likelyPageType,
  type PageType,
} from "@/server/features/site-explorer/rules/pageType";
import type {
  LinkCampaignMode,
  LinkProspectStatus,
} from "@/shared/link-acquisition";

/**
 * The stable identity of a prospect inside a project: the bare host, plus
 * "|path" when the prospect is one specific page. Saving the same site twice,
 * from the gap or by hand, finds the same prospect.
 */
export function dedupeKeyFor(
  domainOrUrl: string,
  pageUrl?: string | null,
): string | null {
  const domain = normaliseDomain(domainOrUrl);
  if (!domain) return null;
  if (!pageUrl) return domain;
  try {
    const path = new URL(pageUrl).pathname.replace(/\/+$/, "").toLowerCase();
    return path && path !== "/" ? `${domain}|${path}` : domain;
  } catch {
    return domain;
  }
}

/**
 * Sponsored links are never filed as earned. A site whose links carry
 * rel=sponsored is a paid placement, so an earned or partnership request for it
 * is saved as sponsored distribution.
 */
export function campaignModeFor(
  requested: LinkCampaignMode,
  sponsoredSeen: boolean,
): { mode: LinkCampaignMode; changed: boolean } {
  if (sponsoredSeen && requested !== "sponsored_distribution") {
    return { mode: "sponsored_distribution", changed: true };
  }
  return { mode: requested, changed: false };
}

type TransitionFacts = {
  hasApprovedDraft: boolean;
  hasSentDraft: boolean;
  hasConfirmedPlacement: boolean;
};

/**
 * Which status moves a person can make by hand. Three states are earned by
 * what happened, not by choosing them: approval needs an approved draft,
 * contacted needs a draft that was exported or marked sent, and acquired needs
 * a placement a check confirmed live.
 */
export function checkTransition(
  next: LinkProspectStatus,
  facts: TransitionFacts,
): string | null {
  if (next === "outreach_approved" && !facts.hasApprovedDraft) {
    return "Approve an outreach draft first. Outreach is approved from the Outreach tab, not by changing the status.";
  }
  if (next === "contacted" && !facts.hasSentDraft) {
    return "Mark a draft as exported or sent from the Outreach tab first.";
  }
  if (next === "acquired" && !facts.hasConfirmedPlacement) {
    return "Verify the live link first. A prospect is acquired when a check finds a real link to the intended page.";
  }
  return null;
}

type OwnPage = { url: string; title: string | null };

type AssetMatch =
  | { kind: "existing"; url: string; reason: string }
  | { kind: "none"; reason: string; topic: string | null }
  | { kind: "unknown"; reason: string };

const MATCH_THRESHOLD = 0.34;

function pageTokens(url: string, title: string | null) {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // keep the raw string
  }
  return new Set(tokenize(`${path} ${title ?? ""}`));
}

function topicOf(url: string, title: string | null) {
  if (title) return title;
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    return slug ? slug.replace(/[-_]+/g, " ") : null;
  } catch {
    return null;
  }
}

const COMMERCIAL: ReadonlySet<PageType> = new Set([
  "collection",
  "product",
  "service",
  "pricing",
  "comparison",
  "homepage",
]);

/**
 * Prefers an existing page: the project page whose path and title share the
 * most words with the pages competitors are linked to. Only when nothing is
 * close does it say a new asset is needed. With no competitor destinations (the
 * gap only has counts) or no page inventory it says it cannot tell, rather than
 * guessing.
 */
export function matchAsset(input: {
  competitorDestinations: Array<{ url: string; title: string | null }>;
  ownPages: OwnPage[];
}): AssetMatch {
  const { competitorDestinations, ownPages } = input;
  if (competitorDestinations.length === 0) {
    return {
      kind: "unknown",
      reason:
        "No competitor destination page is known for this site yet. Read its exact linking pages first.",
    };
  }
  if (ownPages.length === 0) {
    return {
      kind: "unknown",
      reason:
        "No page inventory for this project. Run a site audit, or choose the target page by hand.",
    };
  }
  let best: { url: string; score: number } | null = null;
  for (const destination of competitorDestinations) {
    const wanted = pageTokens(destination.url, destination.title);
    if (wanted.size === 0) continue;
    const wantedType = likelyPageType(destination.url);
    for (const page of ownPages) {
      const have = pageTokens(page.url, page.title);
      let shared = 0;
      for (const token of wanted) if (have.has(token)) shared += 1;
      const union = wanted.size + have.size - shared;
      let score = union === 0 ? 0 : shared / union;
      if (
        wantedType &&
        wantedType === likelyPageType(page.url) &&
        COMMERCIAL.has(wantedType)
      ) {
        score += 0.15;
      }
      if (!best || score > best.score) best = { url: page.url, score };
    }
  }
  if (best && best.score >= MATCH_THRESHOLD) {
    return {
      kind: "existing",
      url: best.url,
      reason:
        "This page shares the most words with the pages competitors are linked to.",
    };
  }
  const first = competitorDestinations[0];
  return {
    kind: "none",
    topic: first ? topicOf(first.url, first.title) : null,
    reason:
      "None of this project's pages is close to what competitors are linked to.",
  };
}
