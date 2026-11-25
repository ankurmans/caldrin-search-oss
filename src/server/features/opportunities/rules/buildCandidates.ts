import type { EngineInputs, OpportunityCandidate } from "../types";
import { commercialPageCandidates } from "./commercialPageRules";
import { decliningCandidates } from "./decliningRules";
import { DEFAULT_MAX_NO_ACTION, gscCandidates } from "./gscCandidates";
import { internalLinkCandidates } from "./internalLinkRules";
import { supportContentCandidates } from "./supportContentRules";
import { technicalCandidates } from "./technicalRules";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function buildFreeCandidates(
  inputs: EngineInputs,
  observedAt: string,
  options: { maxNoAction?: number } = {},
): {
  candidates: OpportunityCandidate[];
  skipped: { rule: string; reason: string }[];
} {
  const skipped = inputs.unavailable.map((u) => ({
    rule: u.source,
    reason: u.reason,
  }));
  const candidates: OpportunityCandidate[] = [];
  if (inputs.gsc) {
    candidates.push(
      ...gscCandidates(
        inputs,
        observedAt,
        options.maxNoAction ?? DEFAULT_MAX_NO_ACTION,
      ),
      ...commercialPageCandidates(inputs, observedAt),
    );
  } else {
    skipped.push({
      rule: "gsc",
      reason:
        "No Search Console data, so query, declining-page and create-page rules did not run.",
    });
  }
  if (inputs.pageWindows) {
    candidates.push(...decliningCandidates(inputs.pageWindows, observedAt));
  } else if (inputs.gsc) {
    skipped.push({
      rule: "declining_pages",
      reason: "No earlier Search Console window to compare against.",
    });
  }
  if (inputs.store) {
    candidates.push(...supportContentCandidates(inputs, observedAt));
  } else {
    skipped.push({
      rule: "shopify",
      reason:
        "No store snapshot, so catalog, support-content and internal-link rules did not run.",
    });
  }
  candidates.push(...internalLinkCandidates(inputs, observedAt));
  if (inputs.audit) {
    candidates.push(...technicalCandidates(inputs.audit, observedAt));
  } else {
    skipped.push({
      rule: "site_audit",
      reason: "No completed site audit, so technical rules did not run.",
    });
  }
  return { candidates, skipped };
}

// One row per dedupe key (a later rule never overwrites an earlier one), then
// highest priority first, then most impressions.
export function rankAndCap(
  candidates: OpportunityCandidate[],
  max: number,
): OpportunityCandidate[] {
  const unique = new Map<string, OpportunityCandidate>();
  for (const c of candidates) {
    if (!unique.has(c.dedupeKey)) unique.set(c.dedupeKey, c);
  }
  const merged = [...unique.values()];
  merged.sort(
    (a, b) =>
      Number(a.action === "no_action") - Number(b.action === "no_action") ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      b.impressions - a.impressions,
  );
  return merged.slice(0, max);
}
