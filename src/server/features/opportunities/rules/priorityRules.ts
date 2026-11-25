import type { OpportunityAction } from "@/server/features/content/rules/opportunityRules";
import type { OpportunityPriority } from "../types";

// Every priority is a rule over a real number, and the sentence returned names
// that number and the threshold it was compared with. No score, no estimate of
// revenue or difficulty.
const HIGH_IMPRESSIONS = 1000;
const MEDIUM_IMPRESSIONS = 250;
const HIGH_CLICKS_LOST = 50;
const MEDIUM_CLICKS_LOST = 10;
const HIGH_SEARCH_VOLUME = 1000;
const MEDIUM_SEARCH_VOLUME = 200;
const MEDIUM_AFFECTED_PAGES = 10;

type Priority = {
  priority: OpportunityPriority;
  priorityReason: string;
};

export function priorityFromImpressions(
  impressions: number,
  action: OpportunityAction,
): Priority {
  if (action === "no_action") {
    return {
      priority: "low",
      priorityReason: `No action recommended, so nothing to prioritize (${impressions} impressions).`,
    };
  }
  const bands = `high at ${HIGH_IMPRESSIONS}+ impressions, medium at ${MEDIUM_IMPRESSIONS}+`;
  if (impressions >= HIGH_IMPRESSIONS) {
    return {
      priority: "high",
      priorityReason: `${impressions} impressions in the window (${bands}).`,
    };
  }
  if (impressions >= MEDIUM_IMPRESSIONS) {
    return {
      priority: "medium",
      priorityReason: `${impressions} impressions in the window (${bands}).`,
    };
  }
  return {
    priority: "low",
    priorityReason: `${impressions} impressions in the window, under the ${MEDIUM_IMPRESSIONS} needed for medium (${bands}).`,
  };
}

export function priorityFromSeverity(input: {
  severity: "critical" | "warning" | "info";
  pageCount: number;
}): Priority {
  const { severity, pageCount } = input;
  const pages = `${pageCount} page${pageCount === 1 ? "" : "s"}`;
  if (severity === "critical") {
    return {
      priority: "high",
      priorityReason: `Critical severity in the site audit, affecting ${pages}. Critical issues are always high.`,
    };
  }
  if (severity === "warning" && pageCount >= MEDIUM_AFFECTED_PAGES) {
    return {
      priority: "medium",
      priorityReason: `Warning severity affecting ${pages} (medium at ${MEDIUM_AFFECTED_PAGES}+ pages).`,
    };
  }
  return {
    priority: "low",
    priorityReason: `${severity === "warning" ? "Warning" : "Info"} severity affecting ${pages}, under the ${MEDIUM_AFFECTED_PAGES} pages needed for medium.`,
  };
}

export function priorityFromClicksLost(input: {
  clicksLost: number;
  previousClicks: number;
  currentClicks: number;
}): Priority {
  const { clicksLost, previousClicks, currentClicks } = input;
  const bands = `high at ${HIGH_CLICKS_LOST}+ clicks lost, medium at ${MEDIUM_CLICKS_LOST}+`;
  const facts = `${clicksLost} fewer clicks (${previousClicks} to ${currentClicks}) between the two windows`;
  if (clicksLost >= HIGH_CLICKS_LOST) {
    return { priority: "high", priorityReason: `${facts} (${bands}).` };
  }
  if (clicksLost >= MEDIUM_CLICKS_LOST) {
    return { priority: "medium", priorityReason: `${facts} (${bands}).` };
  }
  return {
    priority: "low",
    priorityReason: `${facts}, under the ${MEDIUM_CLICKS_LOST} needed for medium (${bands}).`,
  };
}

export function priorityFromSearchVolume(input: {
  searchVolume: number | null;
  competitorPosition: number;
  competitorDomain: string;
}): Priority {
  const { searchVolume, competitorPosition, competitorDomain } = input;
  const rank = `${competitorDomain} ranks at position ${competitorPosition}`;
  if (searchVolume === null) {
    return {
      priority: "low",
      priorityReason: `${rank}, but the provider returned no monthly search volume, so this stays low.`,
    };
  }
  const bands = `high at ${HIGH_SEARCH_VOLUME}+ monthly searches, medium at ${MEDIUM_SEARCH_VOLUME}+`;
  const facts = `${searchVolume} monthly searches; ${rank}`;
  if (searchVolume >= HIGH_SEARCH_VOLUME) {
    return { priority: "high", priorityReason: `${facts} (${bands}).` };
  }
  if (searchVolume >= MEDIUM_SEARCH_VOLUME) {
    return { priority: "medium", priorityReason: `${facts} (${bands}).` };
  }
  return {
    priority: "low",
    priorityReason: `${facts}, under the ${MEDIUM_SEARCH_VOLUME} needed for medium (${bands}).`,
  };
}

// A catalog-only opportunity has no demand number behind it.
export function priorityWithoutDemandData(
  what: string,
  gscRead: boolean,
): Priority {
  const demand = gscRead
    ? "0 impressions for it in the Search Console data read"
    : "No Search Console data connected, so no impression count";
  return {
    priority: "low",
    priorityReason: `${what}. ${demand} (medium needs ${MEDIUM_IMPRESSIONS}+), so it stays low.`,
  };
}
