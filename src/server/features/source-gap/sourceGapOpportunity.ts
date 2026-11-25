import type {
  EvidenceInput,
  OpportunityCandidate,
} from "@/server/features/opportunities/types";
import type { OpportunityAction } from "@/server/features/content/rules/opportunityRules";
import {
  COLLECTION_MODE_LABELS,
  RECOMMENDATION_LABELS,
  ROOT_CAUSE_LABELS,
  type RecommendationAction,
  type SourceGapAnalysis,
} from "@/shared/source-gap";

const MAX_SOURCE_ROWS = 10;
const RANK = { high: 3, medium: 2, low: 1 } as const;

const OPPORTUNITY_ACTION: Record<RecommendationAction, OpportunityAction> = {
  create_owner_page: "create_page",
  choose_owner_page: "no_action",
  pursue_independent_mentions: "earn_third_party_coverage",
  pursue_links_from_cited_ecosystem: "earn_third_party_coverage",
  improve_internal_links: "improve_internal_links",
  no_change_measure_more: "no_action",
  improve_existing_owner: "refresh_existing_page",
  add_pricing_fact: "refresh_existing_page",
  add_comparison_table: "refresh_existing_page",
  add_best_for_section: "refresh_existing_page",
  add_competitor_entities: "refresh_existing_page",
  add_first_hand_test: "refresh_existing_page",
  add_original_benchmark: "refresh_existing_page",
  strengthen_attribution: "refresh_existing_page",
  update_stale_content: "refresh_existing_page",
  add_structured_table: "refresh_existing_page",
};

/** True when the analysis has something to do, beyond measuring more. */
export function actionableRecommendations(analysis: SourceGapAnalysis) {
  return analysis.recommendations.filter(
    (r) =>
      r.action !== "no_change_measure_more" && r.action !== "choose_owner_page",
  );
}

/**
 * A Source Gap analysis as a Search Opportunity. The evidence rows keep the
 * chain from the opportunity back to the answers: run and observation IDs,
 * the engines and collection mode, the cited pages and what was found on them.
 */
export function sourceGapCandidate(
  analysis: SourceGapAnalysis,
  now: string,
): OpportunityCandidate {
  const actions = actionableRecommendations(analysis);
  actions.sort((a, b) => RANK[b.priority] - RANK[a.priority]);
  const top = actions[0];
  if (!top) throw new Error("Nothing to do beyond collecting more runs.");
  const observationIds = [
    ...new Set(analysis.sources.flatMap((s) => s.observationIds)),
  ];
  const source = "ai_visibility";
  const evidence: EvidenceInput[] = [
    { source, label: "Prompt", value: analysis.prompt, observedAt: now },
    {
      source,
      label: "Owner page",
      value: analysis.owner.selected
        ? `${analysis.owner.selected.url} (${analysis.owner.confidence} confidence${analysis.owner.overridden ? ", chosen by a person" : ""})`
        : "No page scored as the owner of this prompt",
      url: analysis.owner.selected?.url ?? null,
    },
    {
      source,
      label: "Collection",
      value: `${COLLECTION_MODE_LABELS[analysis.collectionMode]}; engines ${analysis.stats.engines.map((e) => e.engine).join(", ")}`,
    },
    { source, label: "Run IDs", value: analysis.runIds.join(", ") },
    {
      source,
      label: "Observation IDs",
      value: observationIds.slice(0, 40).join(", "),
    },
    { source, label: "Source Gap analysis", value: analysis.id },
    ...analysis.rootCauses.map((c) => ({
      source,
      label: `${ROOT_CAUSE_LABELS[c.category]} (${c.level}, ${c.confidence} confidence)`,
      value: c.evidence,
    })),
    ...actions.map((r) => ({
      source,
      label: `${RECOMMENDATION_LABELS[r.action]} (${r.priority}, ${r.effort} effort)`,
      value: `${r.reason} ${r.expectedEffect}`,
    })),
    ...analysis.sources
      .filter((s) => s.sourceType !== "own")
      .slice(0, MAX_SOURCE_ROWS)
      .map((s) => ({
        source,
        label: `Cited source (${s.answers} answer(s))`,
        value: `${s.domain}, ${s.sourceType.replaceAll("_", " ")}`,
        url: s.url,
      })),
    ...analysis.measurementNotes.map((note) => ({
      source,
      label: "Measurement caveat",
      value: note,
    })),
  ];
  return {
    dedupeKey: `ai_gap::source_gap::${analysis.promptId}`,
    query: analysis.prompt,
    pageUrl: analysis.owner.selected?.url ?? null,
    action: OPPORTUNITY_ACTION[top.action],
    reason: `${ROOT_CAUSE_LABELS[top.rootCause]}. ${top.reason}`,
    matchedCollectionHandle: null,
    dataSource: "ai_visibility",
    intent: null,
    priority: top.priority,
    priorityReason: top.priorityReason,
    observedAt: now,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    position: 0,
    windowStart: analysis.createdAt,
    windowEnd: now,
    evidence,
  };
}
