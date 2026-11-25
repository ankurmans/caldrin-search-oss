import {
  pageKind,
  type OpportunityAction,
} from "@/server/features/content/rules/opportunityRules";
import { DECLINE_RATIO } from "@/server/features/content/rules/performanceRules";
import type {
  EngineInputs,
  OpportunityCandidate,
  PageWindowRow,
} from "../types";
import { gscMetricEvidence, pagePath, pct } from "./evidence";
import { priorityFromClicksLost } from "./priorityRules";

const MIN_PREVIOUS_CLICKS = 20;
const MIN_PREVIOUS_IMPRESSIONS = 100;
const IMPRESSIONS_HELD_RATIO = 0.8;
const MAX_DECLINING_PAGES = 25;

type Windows = NonNullable<EngineInputs["pageWindows"]>;

function chooseAction(
  page: string,
  previous: PageWindowRow,
  current: PageWindowRow,
): { action: OpportunityAction; why: string } {
  const impressionsHeld =
    current.impressions >= previous.impressions * IMPRESSIONS_HELD_RATIO;
  if (impressionsHeld && current.ctr < previous.ctr) {
    return {
      action: "improve_title_and_meta",
      why: `Impressions held (${previous.impressions} to ${current.impressions}, at least ${IMPRESSIONS_HELD_RATIO * 100}% kept) while CTR fell from ${pct(previous.ctr)} to ${pct(current.ctr)}, so the snippet is earning fewer clicks.`,
    };
  }
  const why = `Impressions went from ${previous.impressions} to ${current.impressions} and average position from ${previous.position.toFixed(1)} to ${current.impressions > 0 ? current.position.toFixed(1) : "no data"}, so the page is being shown or ranked less.`;
  return {
    action:
      pageKind(page) === "collection"
        ? "update_collection_page"
        : "refresh_existing_page",
    why,
  };
}

// Two-window comparison on real Search Console page rows. A page qualifies only
// when it had enough traffic before and kept at most DECLINE_RATIO of its clicks.
export function decliningCandidates(
  windows: Windows,
  observedAt: string,
): OpportunityCandidate[] {
  const currentByPage = new Map(windows.current.map((r) => [r.page, r]));
  const out: { lost: number; candidate: OpportunityCandidate }[] = [];
  for (const previous of windows.previous) {
    if (
      previous.clicks < MIN_PREVIOUS_CLICKS ||
      previous.impressions < MIN_PREVIOUS_IMPRESSIONS
    ) {
      continue;
    }
    const current: PageWindowRow = currentByPage.get(previous.page) ?? {
      page: previous.page,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
    };
    if (current.clicks > previous.clicks * DECLINE_RATIO) continue;
    const clicksLost = previous.clicks - current.clicks;
    const { action, why } = chooseAction(previous.page, previous, current);
    const candidate: OpportunityCandidate = {
      dedupeKey: `declining::${previous.page}`,
      query: pagePath(previous.page),
      pageUrl: previous.page,
      action,
      reason: `Clicks fell from ${previous.clicks} to ${current.clicks}, at or below ${DECLINE_RATIO * 100}% of the earlier window. ${why}`,
      matchedCollectionHandle: null,
      dataSource: "gsc",
      intent: null,
      ...priorityFromClicksLost({
        clicksLost,
        previousClicks: previous.clicks,
        currentClicks: current.clicks,
      }),
      observedAt,
      impressions: current.impressions,
      clicks: current.clicks,
      ctr: current.ctr,
      position: current.position,
      windowStart: windows.currentStart,
      windowEnd: windows.currentEnd,
      evidence: [
        ...gscMetricEvidence({
          source: "gsc",
          row: current,
          windowStart: windows.currentStart,
          windowEnd: windows.currentEnd,
          observedAt,
          labelPrefix: "Current window",
        }),
        ...gscMetricEvidence({
          source: "gsc",
          row: previous,
          windowStart: windows.previousStart,
          windowEnd: windows.previousEnd,
          observedAt,
          labelPrefix: "Previous window",
        }),
        {
          source: "gsc",
          label: "Clicks lost",
          value: `${clicksLost}`,
          url: previous.page,
          observedAt,
        },
      ],
    };
    out.push({ lost: clicksLost, candidate });
  }
  out.sort((a, b) => b.lost - a.lost);
  return out.slice(0, MAX_DECLINING_PAGES).map((entry) => entry.candidate);
}
