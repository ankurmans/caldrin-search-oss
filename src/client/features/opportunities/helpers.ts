import { toast } from "sonner";
import type {
  OpportunityResult,
  getSearchOpportunities,
} from "@/serverFunctions/opportunities";

export type OpportunityRowData = Awaited<
  ReturnType<typeof getSearchOpportunities>
>[number];

export type ActionKey = OpportunityRowData["recommendedAction"];
export type StatusKey = OpportunityRowData["status"];
export type SourceKey = OpportunityRowData["dataSource"];
export type IntentKey =
  | "informational"
  | "commercial"
  | "transactional"
  | "navigational";

export function opportunitiesKey(projectId: string) {
  return ["opportunities", projectId];
}

export function opportunityDetailKey(projectId: string, id: string) {
  return ["opportunities", projectId, "detail", id];
}

// Expected refusals come back as typed results; show them as a toast.
export function unwrap<T>(result: OpportunityResult<T>): T | null {
  if (result.ok) return result.data;
  toast.error(result.reason);
  return null;
}

export const ACTION_LABELS: Record<ActionKey, string> = {
  new_article: "Write a new article",
  refresh_existing_page: "Refresh an existing page",
  update_collection_page: "Update a collection page",
  improve_title_and_meta: "Improve title and meta description",
  create_page: "Create a new page",
  improve_internal_links: "Add internal links",
  technical_fix: "Fix a technical issue",
  earn_third_party_coverage: "Earn third-party coverage",
  review_brand_information: "Check what AI answers say about you",
  no_action: "No action needed",
};

export const STATUS_LABELS: Record<StatusKey, string> = {
  open: "Open",
  briefed: "In progress",
  dismissed: "Dismissed",
};

export const SOURCE_LABELS: Record<SourceKey, string> = {
  gsc: "Search Console",
  simulated: "Demo data",
  dataforseo: "DataForSEO",
  serp: "Search results",
  competitor: "Competitor",
  shopify: "Shopify store",
  site_audit: "Site audit",
  ai_visibility: "AI answers",
  claim_correction: "Claim correction",
  attribution: "Revenue attribution",
};

export const INTENT_LABELS: Record<IntentKey, string> = {
  informational: "Informational",
  commercial: "Commercial",
  transactional: "Transactional",
  navigational: "Navigational",
};

// Only these actions create or rewrite content a draft can be written for.
const DRAFTABLE: ReadonlySet<ActionKey> = new Set([
  "new_article",
  "create_page",
  "refresh_existing_page",
  "update_collection_page",
  "improve_title_and_meta",
]);

export function canDraft(action: ActionKey) {
  return DRAFTABLE.has(action);
}

// The numeric Search Console columns are zero for opportunities from other
// sources, so they are metrics only when Search Console (or the demo) is the source.
export function hasSearchMetrics(source: SourceKey) {
  return source === "gsc" || source === "simulated";
}

export function humanizeRule(rule: string) {
  const text = rule.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatObserved(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function lookup(labels: Record<string, string>, key: string) {
  return Object.entries(labels).find(([name]) => name === key)?.[1];
}

// The row's intent is stored as free text, so look it up rather than index.
export function intentLabel(intent: string) {
  return lookup(INTENT_LABELS, intent) ?? intent;
}

export function actionLabel(action: string) {
  return lookup(ACTION_LABELS, action) ?? humanizeRule(action);
}
