import type { EngineInputs } from "../types";

// Which rule produced a stored row, read from its dedupe key (the keys are set
// in each rule file). Used both to decide what a run covered and to compare a
// row's last-seen time only against rows of the same rule.
export type RuleKind =
  | "gsc_query"
  | "create_page"
  | "declining"
  | "gap"
  | "ilink_orphan"
  | "ilink_article"
  | "support"
  | "technical"
  // Created by hand from AI citation gaps; no analysis run ever covers them.
  | "ai_gap"
  // Created by hand from Source Intelligence; no analysis run covers them.
  | "ai_source"
  // Created by hand from the keyword gap table; no analysis run covers them.
  | "explorer_gap";

export function ruleKindOf(dedupeKey: string): RuleKind {
  if (dedupeKey.startsWith("ilink::orphan::")) return "ilink_orphan";
  if (dedupeKey.startsWith("ilink::article::")) return "ilink_article";
  if (dedupeKey.startsWith("create_page::")) return "create_page";
  if (dedupeKey.startsWith("declining::")) return "declining";
  if (dedupeKey.startsWith("support::")) return "support";
  if (dedupeKey.startsWith("technical::")) return "technical";
  if (dedupeKey.startsWith("gap::")) return "gap";
  if (dedupeKey.startsWith("ai_gap::")) return "ai_gap";
  if (dedupeKey.startsWith("ai_source::")) return "ai_source";
  if (dedupeKey.startsWith("explorer_gap::")) return "explorer_gap";
  return "gsc_query";
}

// A rule "covered" a run when its inputs were present and it ran. A row from a
// rule that did not run (Search Console down, no audit, paid rule not asked
// for) says nothing about whether it is still true, so a run never removes it.
export function coveredRules(
  inputs: EngineInputs,
  paidRan: boolean,
): ReadonlySet<RuleKind> {
  const covered = new Set<RuleKind>();
  if (inputs.gsc) {
    covered.add("gsc_query");
    covered.add("create_page");
  }
  if (inputs.pageWindows) covered.add("declining");
  if (inputs.store) covered.add("support");
  if (inputs.store && inputs.gsc) covered.add("ilink_article");
  if (inputs.audit) {
    covered.add("ilink_orphan");
    covered.add("technical");
  }
  if (paidRan) covered.add("gap");
  return covered;
}

// A row kept because it has history, but that the latest analysis did not
// produce, carries one evidence row with this source and label. The marker is
// written by the run that noticed and disappears when a later run produces the
// row again (evidence is replaced on every upsert), so "no longer found" needs
// no column of its own.
export const NOT_FOUND_EVIDENCE = {
  source: "analysis",
  label: "Not found in the latest analysis",
} as const;
