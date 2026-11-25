import type { getCommandCentre } from "@/serverFunctions/command-centre";
import type { ActionKey } from "@/client/features/opportunities/helpers";

export type CommandCentreData = Awaited<ReturnType<typeof getCommandCentre>>;
export type NextAction = NonNullable<
  CommandCentreData["opportunities"]
>["next"][number];

export function commandCentreKey(projectId: string) {
  return ["commandCentre", projectId] as const;
}

const DAY_MS = 86_400_000;

/** Older than a week reads as stale on a freshness chip. */
export function isStale(iso: string | null, days = 7): boolean {
  return iso !== null && Date.now() - Date.parse(iso) > days * DAY_MS;
}

// Effort is a rough size of the work, not a time estimate.
const EFFORT: Record<ActionKey, "Low" | "Medium" | "High"> = {
  improve_title_and_meta: "Low",
  improve_internal_links: "Low",
  review_brand_information: "Low",
  technical_fix: "Medium",
  refresh_existing_page: "Medium",
  update_collection_page: "Medium",
  earn_third_party_coverage: "High",
  new_article: "High",
  create_page: "High",
  no_action: "Low",
};

export function effortFor(action: ActionKey) {
  return EFFORT[action];
}

/**
 * How much search data stands behind an opportunity, from its impressions in
 * the window. It says how much to trust the numbers, not how big the win is.
 */
export function sampleStrength(impressions: number): "Low" | "Medium" | "High" {
  if (impressions < 100) return "Low";
  if (impressions < 1000) return "Medium";
  return "High";
}

export function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function signed(value: number, unit: string) {
  return `${value > 0 ? "+" : ""}${value}${unit}`;
}
