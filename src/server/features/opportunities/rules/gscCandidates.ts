import {
  decideOpportunities,
  type OpportunityDecision,
} from "@/server/features/content/rules/opportunityRules";
import type { EngineInputs, OpportunityCandidate } from "../types";
import { classifyIntent } from "./intentRules";
import { gscMetricEvidence } from "./evidence";
import { priorityFromImpressions } from "./priorityRules";

type GscInput = NonNullable<EngineInputs["gsc"]>;

export const DEFAULT_MAX_NO_ACTION = 25;

// The key the original extraction used, so a re-run updates its rows.
function gscDedupeKey(query: string, pageUrl: string): string {
  return `${query.trim().toLowerCase()}|${pageUrl}`;
}

function toCandidate(
  decision: OpportunityDecision,
  gsc: GscInput,
  inputs: EngineInputs,
  observedAt: string,
): OpportunityCandidate {
  const priority = priorityFromImpressions(
    decision.impressions,
    decision.action,
  );
  const evidence = gscMetricEvidence({
    source: gsc.source,
    row: {
      query: decision.query,
      page: decision.pageUrl,
      clicks: decision.clicks,
      impressions: decision.impressions,
      ctr: decision.ctr,
      position: decision.position,
    },
    windowStart: gsc.windowStart,
    windowEnd: gsc.windowEnd,
    observedAt,
  });
  const collection = inputs.store?.collections.find(
    (c) => c.handle === decision.matchedCollectionHandle,
  );
  if (collection) {
    evidence.push({
      source: "shopify",
      label: "Matching collection",
      value: collection.title,
      url: `/collections/${collection.handle}`,
      observedAt,
    });
  }
  return {
    dedupeKey: gscDedupeKey(decision.query, decision.pageUrl),
    query: decision.query,
    pageUrl: decision.pageUrl,
    action: decision.action,
    reason: decision.reason,
    matchedCollectionHandle: decision.matchedCollectionHandle,
    dataSource: gsc.source,
    intent: classifyIntent(decision.query, {
      brandTerms: inputs.brandTerms,
      store: inputs.store,
    }),
    ...priority,
    observedAt,
    impressions: decision.impressions,
    clicks: decision.clicks,
    ctr: decision.ctr,
    position: decision.position,
    windowStart: gsc.windowStart,
    windowEnd: gsc.windowEnd,
    evidence,
  };
}

// Reuses the existing GSC rules unchanged. "No action" outcomes are kept, with
// the rule's reason, but capped to the highest-impression ones so they do not
// bury the real recommendations.
export function gscCandidates(
  inputs: EngineInputs,
  observedAt: string,
  maxNoAction = DEFAULT_MAX_NO_ACTION,
): OpportunityCandidate[] {
  const gsc = inputs.gsc;
  if (!gsc) return [];
  const decisions = decideOpportunities(
    gsc.rows,
    inputs.store?.collections ?? [],
  );
  let noAction = 0;
  const kept = decisions.filter((d) => {
    if (d.action !== "no_action") return true;
    noAction += 1;
    return noAction <= maxNoAction;
  });
  return kept.map((d) => toCandidate(d, gsc, inputs, observedAt));
}
