import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { normaliseDomain } from "@/server/features/site-explorer/rules/gapMerge";
import {
  fetchSourcePage,
  type FetchDeps,
} from "@/server/features/source-gap/sourcePageFetcher";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { safeHttpUrl } from "@/shared/safe-url";
import type { LinkActor, LinkCampaignMode } from "@/shared/link-acquisition";
import {
  LinkPlacementRepository,
  type NewCheck,
  type PlacementRecord,
  type PlacementState,
} from "../repositories/LinkPlacementRepository";
import { LinkProspectRepository } from "../repositories/LinkProspectRepository";
import {
  attributesOf,
  comparableUrl,
  decideOutcome,
  hostOf,
  linksTo,
  linksToSite,
  readPage,
  type CheckOutcome,
  type PageLink,
} from "../rules/linkVerification";
import type { LinkAcquisitionContext } from "./linkAcquisitionShared";

const DAY_MS = 86_400_000;
// A page that redirects or has a canonical can still be the intended page;
// checking more than a few of a page's links to the site would be a crawl.
const MAX_REDIRECT_CANDIDATES = 3;

const visible = (link: PageLink) => !link.hidden;
const RECHECK_AFTER_MS = DAY_MS;
const RECHECK_PER_RUN = 200;
const RECHECK_PER_PROJECT = 20;
const SCHEDULED_JOB = "link_recheck";

type VerifyDeps = FetchDeps;

const actorOf = (ctx: LinkAcquisitionContext): LinkActor => ctx.actor ?? "user";

function isOwnHost(host: string | null, own: string) {
  return host !== null && (host === own || host.endsWith(`.${own}`));
}

async function create(
  ctx: LinkAcquisitionContext,
  input: {
    urlFrom: string;
    expectedTarget: string;
    campaignMode: LinkCampaignMode;
    prospectId?: string | null;
    state: "promised" | "observed";
    costUsd?: number | null;
  },
) {
  const urlFrom = safeHttpUrl(input.urlFrom.trim());
  const expectedTarget = safeHttpUrl(input.expectedTarget.trim());
  if (!urlFrom || !expectedTarget) {
    throw new OpportunityRefusal("Both addresses must be http or https URLs.");
  }
  const project = await OpportunityRepository.getProjectBrand(ctx.projectId);
  const own = project?.domain ? normaliseDomain(project.domain) : null;
  if (!own) throw new OpportunityRefusal("This project has no domain set.");
  if (!isOwnHost(hostOf(expectedTarget), own)) {
    throw new OpportunityRefusal(
      `The page the link should point to must be on ${own}.`,
    );
  }
  if (isOwnHost(hostOf(urlFrom), own)) {
    throw new OpportunityRefusal(
      "A link from your own site is an internal link, not an acquired one.",
    );
  }
  let mode = input.campaignMode;
  let prospectId: string | null = null;
  if (input.prospectId) {
    const prospect = await LinkProspectRepository.getOne(
      ctx.projectId,
      input.prospectId,
    );
    if (!prospect) throw new OpportunityRefusal("That prospect was not found.");
    prospectId = prospect.id;
    if (prospect.campaignMode === "sponsored_distribution") {
      mode = "sponsored_distribution";
    }
  }
  return LinkPlacementRepository.insert({
    projectId: ctx.projectId,
    prospectId,
    campaignMode: mode,
    urlFrom,
    expectedTarget,
    state: input.state,
    costUsd: input.costUsd ?? null,
    actor: actorOf(ctx),
  });
}

/** Chooses the placement's next state from the check, never skipping what was confirmed. */
function nextState(
  current: PlacementState,
  outcome: CheckOutcome,
): PlacementState {
  if (outcome === "confirmed" || outcome === "attributes_changed") {
    return "confirmed_live";
  }
  // Removal and loss of verifiability only mean something for a link that was
  // once confirmed; a link never seen live was never removed.
  const wasLive =
    current === "confirmed_live" || current === "no_longer_verifiable";
  if (outcome === "unverifiable") {
    return wasLive ? "no_longer_verifiable" : current;
  }
  return wasLive || current === "later_removed" ? "later_removed" : current;
}

async function runCheck(
  placement: PlacementRecord,
  deps: VerifyDeps,
): Promise<NewCheck> {
  const checkedAt = new Date().toISOString();
  const base: NewCheck = {
    outcome: "unverifiable",
    httpStatus: null,
    finalUrl: null,
    canonicalUrl: null,
    foundHref: null,
    anchor: null,
    isNofollow: null,
    isSponsored: null,
    isUgc: null,
    context: null,
    note: null,
    checkedAt,
  };
  const page = await fetchSourcePage(placement.urlFrom, {
    ...deps,
    allowHomepage: true,
  });
  if (page.status === "not_found") {
    return {
      ...base,
      outcome: "page_gone",
      httpStatus: page.httpStatus,
      finalUrl: page.finalUrl,
      note: page.note,
    };
  }
  if (page.status !== "ok" || page.html === null) {
    return {
      ...base,
      httpStatus: page.httpStatus,
      finalUrl: page.finalUrl,
      note: page.note ?? "The page could not be read.",
    };
  }
  const reading = readPage(page.html, page.finalUrl);
  let found = linksTo(reading, placement.expectedTarget).find(visible) ?? null;
  const notes: string[] = [];
  if (!found) {
    // The link may go through a redirect or a tracking URL whose final page or
    // canonical is the intended one.
    for (const candidate of linksToSite(reading, placement.expectedTarget)
      .filter(visible)
      .slice(0, MAX_REDIRECT_CANDIDATES)) {
      const target = await fetchSourcePage(candidate.href, {
        ...deps,
        allowHomepage: true,
      });
      const resolved = [
        target.finalUrl,
        target.html ? readPage(target.html, target.finalUrl).canonical : null,
      ];
      if (
        resolved.some(
          (url) =>
            url !== null &&
            comparableUrl(url) === comparableUrl(placement.expectedTarget),
        )
      ) {
        found = candidate;
        notes.push(
          `The link resolves to the intended page through ${candidate.href}.`,
        );
        break;
      }
    }
  }
  const otherSiteLinks = linksToSite(reading, placement.expectedTarget).filter(
    visible,
  );
  const [last] = (
    await LinkPlacementRepository.checksOf([placement.id], 10)
  ).filter((check) => check.foundHref && check.outcome !== "link_missing");
  const previous = last
    ? {
        href: last.foundHref,
        attributes: {
          isNofollow: last.isNofollow === true,
          isSponsored: last.isSponsored === true,
          isUgc: last.isUgc === true,
        },
      }
    : null;
  const outcome = decideOutcome({ found, otherSiteLinks, previous });
  if (reading.noindex) notes.push("The linking page is marked noindex.");
  if (
    reading.canonical &&
    comparableUrl(reading.canonical) !== comparableUrl(page.finalUrl)
  ) {
    notes.push(`The page's canonical is ${reading.canonical}.`);
  }
  if (!found && otherSiteLinks.length > 0) {
    notes.push(`It links to ${otherSiteLinks[0]?.href} instead.`);
  }
  if (
    !found &&
    reading.links.some(
      (l) =>
        l.hidden &&
        comparableUrl(l.href) === comparableUrl(placement.expectedTarget),
    )
  ) {
    notes.push("The only link to the page is hidden.");
  }
  const shown =
    found ??
    (outcome === "destination_changed" ? (otherSiteLinks[0] ?? null) : null);
  const attributes = shown ? attributesOf(shown) : null;
  return {
    ...base,
    outcome,
    httpStatus: page.httpStatus,
    finalUrl: page.finalUrl,
    canonicalUrl: reading.canonical,
    foundHref: shown?.href ?? null,
    anchor: shown?.anchor || null,
    isNofollow: attributes?.isNofollow ?? null,
    isSponsored: attributes?.isSponsored ?? null,
    isUgc: attributes?.isUgc ?? null,
    context: shown?.context || null,
    note: notes.join(" ") || null,
  };
}

/**
 * An earned link confirmed live is a change to the project's search surface,
 * so it goes in the Change Ledger and gets the same before/after readings as
 * any other change. The ledger records readings, never causation. A failure
 * here never undoes the verification.
 */
async function recordInLedger(
  projectId: string,
  userId: string,
  placement: PlacementRecord,
  check: NewCheck,
) {
  try {
    const organizationId =
      await LinkPlacementRepository.organizationOf(projectId);
    if (!organizationId) return;
    await LedgerService.recordObservedChange(
      { projectId, organizationId, userId },
      {
        kind: "link_acquired",
        targetUrl: placement.expectedTarget,
        proposedAction: `Link from ${placement.urlFrom} to ${placement.expectedTarget}, confirmed live by fetching the page.`,
        afterState: check.anchor
          ? `Anchor: ${check.anchor}${check.isNofollow ? " (nofollow)" : ""}`
          : null,
        measurementMetric: "clicks",
        measurementWindowDays: 28,
        evidence: [
          {
            source: "link_check",
            label: "Linking page",
            value: check.note ?? "The link was found in the fetched page.",
            url: placement.urlFrom,
            observedAt: check.checkedAt ?? null,
          },
        ],
        idempotencyKey: `link_acquired:${placement.id}`,
      },
    );
  } catch (error) {
    console.error("[link-ledger] could not record", placement.id, error);
  }
}

/** Fetches the linking page, records what was found, and moves the placement and its prospect. */
async function verify(
  ctx: { projectId: string },
  placementId: string,
  actor: LinkActor,
  userId: string,
  deps: VerifyDeps = {},
) {
  const placement = await LinkPlacementRepository.get(
    ctx.projectId,
    placementId,
  );
  if (!placement) throw new OpportunityRefusal("That link was not found.");
  const check = await runCheck(placement, deps);
  const state = nextState(placement.state, check.outcome);
  await LinkPlacementRepository.recordCheck({
    projectId: ctx.projectId,
    placement,
    check,
    state,
  });
  if (state === "confirmed_live" && placement.state !== "confirmed_live") {
    await recordInLedger(ctx.projectId, userId, placement, check);
  }
  if (placement.prospectId) {
    const prospect = await LinkProspectRepository.getOne(
      ctx.projectId,
      placement.prospectId,
    );
    if (prospect) {
      const next =
        state === "confirmed_live" && prospect.status !== "acquired"
          ? "acquired"
          : state === "later_removed" && prospect.status === "acquired"
            ? "lost"
            : null;
      if (next) {
        await LinkProspectRepository.applyPatch({
          projectId: ctx.projectId,
          rows: [prospect],
          patch: { status: next },
          note:
            next === "acquired"
              ? `Link confirmed live on ${placement.urlFrom}`
              : `Link no longer found on ${placement.urlFrom}`,
          actor,
          userId,
        });
      }
    }
  }
  return { outcome: check.outcome, state, note: check.note };
}

async function verifyForContext(
  ctx: LinkAcquisitionContext,
  placementId: string,
  deps?: VerifyDeps,
) {
  return verify(ctx, placementId, actorOf(ctx), ctx.userId, deps);
}

async function list(projectId: string) {
  const placements = await LinkPlacementRepository.list(projectId);
  const checks = await LinkPlacementRepository.checksOf(
    placements.map((placement) => placement.id),
  );
  return placements.map((placement) => ({
    ...placement,
    checks: checks.filter((check) => check.placementId === placement.id),
  }));
}

/**
 * The daily pass: re-checks links that have not been checked for a day. It
 * calls no provider, fetches only the linking pages through the same
 * SSRF-guarded fetch, and counts as one scheduled job per project.
 */
export async function runScheduledLinkChecks(deps: VerifyDeps = {}) {
  const before = new Date(Date.now() - RECHECK_AFTER_MS).toISOString();
  const dueRows = await LinkPlacementRepository.due(before, RECHECK_PER_RUN);
  const byProject = new Map<string, typeof dueRows>();
  for (const row of dueRows) {
    byProject.set(row.placement.projectId, [
      ...(byProject.get(row.placement.projectId) ?? []),
      row,
    ]);
  }
  const report = { projects: 0, checked: 0, skippedForLimit: 0, failed: 0 };
  for (const [projectId, rows] of byProject) {
    const scope = {
      projectId,
      organizationId: rows[0]?.organizationId ?? "",
      userId: "system",
    };
    try {
      await SpendService.assertScheduledJobAllowed(scope, SCHEDULED_JOB);
    } catch {
      report.skippedForLimit += 1;
      continue;
    }
    await SpendService.recordScheduledRun(scope, SCHEDULED_JOB);
    report.projects += 1;
    for (const row of rows.slice(0, RECHECK_PER_PROJECT)) {
      try {
        await verify({ projectId }, row.placement.id, "system", "system", deps);
        report.checked += 1;
      } catch (error) {
        report.failed += 1;
        console.error("[link-check] failed", row.placement.id, error);
      }
    }
  }
  return report;
}

export const LinkVerificationService = {
  create,
  verify: verifyForContext,
  list,
  updateCost: LinkPlacementRepository.updateCost,
};
