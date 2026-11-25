import {
  MIN_IMPRESSIONS,
  TOP_POSITION_MAX,
  pageKind,
} from "@/server/features/content/rules/opportunityRules";
import type {
  EngineInputs,
  EvidenceInput,
  OpportunityCandidate,
} from "../types";
import { pct } from "./evidence";
import { priorityFromImpressions, priorityFromSeverity } from "./priorityRules";
import { articleCovers, collectionDemand } from "./supportContentRules";

const MAX_ORPHAN_PAGES = 25;

function impressionsByPage(inputs: EngineInputs): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of inputs.gsc?.rows ?? []) {
    map.set(row.page, (map.get(row.page) ?? 0) + row.impressions);
  }
  return map;
}

// Pages the audit found with no inbound link, kept when they are a store page
// type (product, collection, article) or already show up in Search Console.
function orphanCandidates(
  inputs: EngineInputs,
  observedAt: string,
): OpportunityCandidate[] {
  const audit = inputs.audit;
  if (!audit) return [];
  const impressions = impressionsByPage(inputs);
  const day = audit.observedAt.slice(0, 10);
  const seen = new Set<string>();
  const out: OpportunityCandidate[] = [];
  for (const issue of audit.issues) {
    if (issue.issueType !== "orphan-page" || seen.has(issue.pageUrl)) continue;
    seen.add(issue.pageUrl);
    const seenImpressions = impressions.get(issue.pageUrl) ?? 0;
    if (pageKind(issue.pageUrl) === "other" && seenImpressions === 0) continue;
    const evidence: EvidenceInput[] = [
      {
        source: "site_audit",
        label: "Issue",
        value: "Orphan page: no crawled page links to it",
        url: issue.pageUrl,
        observedAt: audit.observedAt,
      },
    ];
    if (inputs.gsc && seenImpressions > 0) {
      evidence.push({
        source: inputs.gsc.source,
        label: "Impressions",
        value: `${seenImpressions}`,
        url: issue.pageUrl,
        observedAt,
      });
    }
    out.push({
      dedupeKey: `ilink::orphan::${issue.pageUrl}`,
      query: issue.pageUrl,
      pageUrl: issue.pageUrl,
      action: "improve_internal_links",
      reason: `The latest site audit found no internal link pointing to this ${pageKind(issue.pageUrl)} page.${seenImpressions > 0 ? ` It still has ${seenImpressions} impressions in Search Console.` : ""}`,
      matchedCollectionHandle: null,
      dataSource: "site_audit",
      intent: null,
      ...(seenImpressions > 0
        ? priorityFromImpressions(seenImpressions, "improve_internal_links")
        : priorityFromSeverity({ severity: issue.severity, pageCount: 1 })),
      observedAt,
      impressions: seenImpressions,
      clicks: 0,
      ctr: 0,
      position: 0,
      windowStart: day,
      windowEnd: day,
      evidence,
    });
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return out.slice(0, MAX_ORPHAN_PAGES);
}

// An existing article written around a collection, and that collection page
// ranking below the top results with real impressions: the article is a natural
// source of a link. The stored data has no link graph, so the reason says the
// existing links were not checked.
function articleToCollectionCandidates(
  inputs: EngineInputs,
  observedAt: string,
): OpportunityCandidate[] {
  const store = inputs.store;
  const gsc = inputs.gsc;
  if (!store || !gsc) return [];
  const pageImpressions = impressionsByPage(inputs);
  const out: OpportunityCandidate[] = [];
  for (const demand of collectionDemand(inputs)) {
    if (demand.impressions < MIN_IMPRESSIONS) continue;
    if (demand.position <= TOP_POSITION_MAX) continue;
    for (const article of store.articles) {
      if (!articleCovers(article, demand.title)) continue;
      const articleUrl =
        [...pageImpressions.keys()].find((page) =>
          page.replace(/\/$/, "").endsWith(`/${article.handle}`),
        ) ?? null;
      out.push({
        dedupeKey: `ilink::article::${article.handle}::${demand.handle}`,
        query: `Link "${article.title}" to ${demand.title}`,
        pageUrl: demand.pageUrl,
        action: "improve_internal_links",
        reason: `The "${demand.title}" collection page has ${demand.impressions} impressions at average position ${demand.position.toFixed(1)} (below the top ${TOP_POSITION_MAX}). The store's article "${article.title}" covers the same topic and is a natural place to link to it. Existing links were not checked, so confirm the article does not already link.`,
        matchedCollectionHandle: demand.handle,
        dataSource: gsc.source,
        intent: null,
        ...priorityFromImpressions(
          demand.impressions,
          "improve_internal_links",
        ),
        observedAt,
        impressions: demand.impressions,
        clicks: demand.clicks,
        ctr: demand.clicks / demand.impressions,
        position: demand.position,
        windowStart: gsc.windowStart,
        windowEnd: gsc.windowEnd,
        evidence: [
          {
            source: "shopify",
            label: "Source article",
            value: article.title,
            url: articleUrl,
            observedAt,
          },
          {
            source: "shopify",
            label: "Target collection",
            value: demand.title,
            url: demand.pageUrl,
            observedAt,
          },
          ...[
            ["Collection page impressions", `${demand.impressions}`],
            ["Collection page clicks", `${demand.clicks}`],
            ["Collection page CTR", pct(demand.clicks / demand.impressions)],
            ["Collection page average position", demand.position.toFixed(1)],
            ["Window", `${gsc.windowStart} to ${gsc.windowEnd}`],
          ].map(([label, value]) => ({
            source: gsc.source,
            label: label ?? "",
            value: value ?? "",
            url: demand.pageUrl,
            observedAt,
          })),
        ],
      });
    }
  }
  return out;
}

export function internalLinkCandidates(
  inputs: EngineInputs,
  observedAt: string,
): OpportunityCandidate[] {
  return [
    ...orphanCandidates(inputs, observedAt),
    ...articleToCollectionCandidates(inputs, observedAt),
  ];
}
