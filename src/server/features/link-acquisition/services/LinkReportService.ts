import { LinkOutreachRepository } from "../repositories/LinkOutreachRepository";
import { LinkPlacementRepository } from "../repositories/LinkPlacementRepository";
import { LinkProspectRepository } from "../repositories/LinkProspectRepository";
import { hostOf } from "../rules/linkVerification";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Counts of what the program has done. Nothing here says a link moved
 * rankings: placements are counted only as confirmed by a page check.
 */
async function report(projectId: string) {
  const [prospects, outreach, states, cost, placements] = await Promise.all([
    LinkProspectRepository.statusCounts(projectId),
    Promise.all([
      LinkOutreachRepository.statusCounts(projectId),
      LinkOutreachRepository.replyCount(projectId),
    ]),
    LinkPlacementRepository.stateCounts(projectId),
    LinkPlacementRepository.costTotals(projectId),
    LinkPlacementRepository.list(projectId),
  ]);
  const [drafts, replies] = outreach;
  const draft = (status: keyof typeof drafts) => drafts[status] ?? 0;
  const live = placements.filter((p) => p.state === "confirmed_live");
  const liveByMode = (sponsored: boolean) =>
    live.filter(
      (p) => (p.campaignMode === "sponsored_distribution") === sponsored,
    ).length;
  const stateTotal = (state: string) =>
    sum(states.filter((row) => row.state === state).map((row) => row.total));
  return {
    prospects: sum(Object.values(prospects)),
    qualified: prospects.qualified ?? 0,
    outreachApproved: draft("approved") + draft("exported") + draft("sent"),
    sent: draft("sent"),
    responses: replies,
    placementsRecorded: placements.length,
    confirmedLive: live.length,
    verifiedReferringDomains: new Set(
      live.map((p) => hostOf(p.urlFrom)).filter((host) => host !== null),
    ).size,
    earnedLive: liveByMode(false),
    sponsoredLive: liveByMode(true),
    laterRemoved: stateTotal("later_removed"),
    noLongerVerifiable: stateTotal("no_longer_verifiable"),
    lostProspects: prospects.lost ?? 0,
    recordedCostUsd: cost,
    note: "Counts of recorded activity and page checks. They do not show that any link changed rankings.",
  };
}

export const LinkReportService = { report };
