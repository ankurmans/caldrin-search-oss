/* eslint-disable max-lines */
import { ContentService } from "@/server/features/content/services/ContentService";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import type { OpportunityCandidate } from "@/server/features/opportunities/types";
import { loadSourceIntelligence } from "@/server/features/source-intelligence/services/SourceIntelligenceService";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import type { LinkCampaignMode } from "@/shared/link-acquisition";
import type {
  ProspectListQuery,
  ProspectPatch,
} from "@/types/schemas/link-acquisition";
import {
  LinkProspectRepository,
  type LinkProspectRecord,
  type NewProspect,
} from "../repositories/LinkProspectRepository";
import {
  campaignModeFor,
  checkTransition,
  dedupeKeyFor,
  matchAsset,
} from "../rules/prospectRules";
import { LinkGapRepository } from "../repositories/LinkGapRepository";
import { LinkGapService } from "./LinkGapService";
import type { LinkAcquisitionContext } from "./linkAcquisitionShared";

const MAX_SAVE = 100;
const PROVIDER = "dataforseo";

function actorOf(ctx: LinkAcquisitionContext) {
  return ctx.actor ?? "user";
}

/** Saves link gap rows as prospects. Rows already saved are left untouched. */
async function saveFromGap(
  ctx: LinkAcquisitionContext,
  input: { runId: string; domains: string[]; campaignMode: LinkCampaignMode },
) {
  const loaded = await LinkGapService.loadScored(ctx.projectId, input.runId);
  if (!loaded) throw new OpportunityRefusal("That link gap run was not found.");
  const wanted = new Set(input.domains.map((domain) => domain.toLowerCase()));
  const rows = loaded.rows.filter((row) => wanted.has(row.referringDomain));
  if (rows.length === 0) {
    throw new OpportunityRefusal("None of those domains are in this run.");
  }
  const ownPages = await LinkProspectRepository.ownPages(ctx.projectId);
  const prospects: NewProspect[] = [];
  let remodeled = 0;
  for (const row of rows.slice(0, MAX_SAVE)) {
    const key = dedupeKeyFor(row.referringDomain);
    if (!key) continue;
    const { mode, changed } = campaignModeFor(
      input.campaignMode,
      row.qualification.attributes.sponsored,
    );
    if (changed) remodeled += 1;
    const match = matchAsset({
      competitorDestinations: row.evidence.map((item) => ({
        url: item.urlTo,
        title: null,
      })),
      ownPages,
    });
    prospects.push({
      dedupeKey: key,
      referringDomain: row.referringDomain,
      pageUrl: null,
      method: "competitor_intersection",
      campaignMode: mode,
      status: "discovered",
      recommendation: row.qualification.recommendation,
      score: Math.round(row.qualification.score),
      targetUrl: match.kind === "existing" ? match.url : null,
      sourceRunId: loaded.run.id,
      notes: changed
        ? "Links on this site carry rel=sponsored, so it is filed as sponsored distribution, not earned."
        : null,
      signals: [],
    });
  }
  if (prospects.length === 0) {
    throw new OpportunityRefusal(
      "None of those sites could be saved: they are not valid public domains.",
    );
  }
  const result = await LinkProspectRepository.insertNew(
    ctx.projectId,
    prospects,
    actorOf(ctx),
    ctx.userId,
  );
  return {
    created: result.created.length,
    alreadySaved: result.skipped.length,
    filedAsSponsored: remodeled,
  };
}

async function saveManual(
  ctx: LinkAcquisitionContext,
  input: {
    domainOrUrl: string;
    pageUrl?: string | null;
    campaignMode: LinkCampaignMode;
    notes?: string | null;
  },
) {
  const key = dedupeKeyFor(input.domainOrUrl, input.pageUrl);
  if (!key) throw new OpportunityRefusal("That is not a domain.");
  const result = await LinkProspectRepository.insertNew(
    ctx.projectId,
    [
      {
        dedupeKey: key,
        referringDomain: key.split("|")[0] ?? key,
        pageUrl: input.pageUrl ?? null,
        method: "manual",
        campaignMode: input.campaignMode,
        status: "discovered",
        recommendation: null,
        score: null,
        targetUrl: null,
        sourceRunId: null,
        notes: input.notes ?? null,
        signals: [],
      },
    ],
    actorOf(ctx),
    ctx.userId,
  );
  return {
    created: result.created.length,
    alreadySaved: result.skipped.length,
  };
}

/**
 * Sites AI answers already cite. Reads the stored Source Intelligence, so it
 * costs nothing and calls no provider. Sites that belong to this project or a
 * compared competitor are not prospects.
 */
async function aiCitedSources(projectId: string) {
  const data = await loadSourceIntelligence({
    projectId,
    filters: { days: 90, hideDismissed: true },
    view: "domains",
    sortBy: "cited",
    sortDir: "desc",
    page: 1,
    pageSize: 100,
  });
  return {
    answers: data.answers,
    rows: data.rows
      .filter((row) => row.brand === null && row.citedAnswers > 0)
      .map((row) => ({
        domain: row.domain,
        citedAnswers: row.citedAnswers,
        retrievedAnswers: row.retrievedAnswers,
        engines: row.engines,
        lastSeen: row.lastSeen,
      })),
  };
}

async function saveFromAiCitations(
  ctx: LinkAcquisitionContext,
  input: { domains: string[]; campaignMode: LinkCampaignMode },
) {
  const found = await aiCitedSources(ctx.projectId);
  const wanted = new Set(input.domains.map((domain) => domain.toLowerCase()));
  const rows = found.rows.filter((row) => wanted.has(row.domain));
  if (rows.length === 0) {
    throw new OpportunityRefusal(
      "None of those sites is cited in the stored AI answers.",
    );
  }
  const now = new Date().toISOString();
  const prospects: NewProspect[] = [];
  for (const row of rows.slice(0, MAX_SAVE)) {
    const key = dedupeKeyFor(row.domain);
    if (!key) continue;
    const observedAt = row.lastSeen ?? now;
    prospects.push({
      dedupeKey: key,
      referringDomain: key,
      pageUrl: null,
      method: "ai_citation",
      campaignMode: input.campaignMode,
      status: "discovered",
      recommendation: "review",
      score: null,
      targetUrl: null,
      sourceRunId: null,
      notes: null,
      signals: [
        {
          kind: "ai_cited_answers",
          value: String(row.citedAnswers),
          source: "source_intelligence",
          observedAt,
        },
        {
          kind: "ai_retrieved_answers",
          value: String(row.retrievedAnswers),
          source: "source_intelligence",
          observedAt,
        },
        {
          kind: "ai_engines",
          value: row.engines.join(", "),
          source: "source_intelligence",
          observedAt,
        },
      ],
    });
  }
  const result = await LinkProspectRepository.insertNew(
    ctx.projectId,
    prospects,
    actorOf(ctx),
    ctx.userId,
  );
  return {
    created: result.created.length,
    alreadySaved: result.skipped.length,
  };
}

async function list(projectId: string, query: ProspectListQuery) {
  const [{ rows, total }, counts] = await Promise.all([
    LinkProspectRepository.list(projectId, query),
    LinkProspectRepository.statusCounts(projectId),
  ]);
  const signals = await LinkProspectRepository.signalsOf(
    rows.map((row) => row.id),
  );
  return {
    total,
    counts,
    rows: rows.map((row) => ({
      ...row,
      signals: signals.filter((signal) => signal.prospectId === row.id),
    })),
  };
}

async function detail(projectId: string, id: string) {
  const prospect = await LinkProspectRepository.getOne(projectId, id);
  if (!prospect) return null;
  const [events, signals] = await Promise.all([
    LinkProspectRepository.eventsOf(id),
    LinkProspectRepository.signalsOf([id]),
  ]);
  return { prospect, events, signals };
}

async function checkAssignee(
  ctx: LinkAcquisitionContext,
  assigneeUserId: string | null | undefined,
) {
  if (!assigneeUserId) return;
  const membership = await AuthRepository.getMembership(
    assigneeUserId,
    ctx.organizationId,
  );
  if (!membership) {
    throw new OpportunityRefusal(
      "That person is not a member of this workspace.",
    );
  }
}

/** Bulk status, mode, assignee, due date, notes or target page. */
async function update(
  ctx: LinkAcquisitionContext,
  input: { ids: string[]; patch: ProspectPatch; note?: string | null },
) {
  const rows = await LinkProspectRepository.getMany(ctx.projectId, input.ids);
  if (rows.length === 0) {
    throw new OpportunityRefusal("Those prospects were not found.");
  }
  await checkAssignee(ctx, input.patch.assigneeUserId);
  const { status, campaignMode } = input.patch;
  if (status) {
    const facts = await LinkProspectRepository.facts(rows.map((r) => r.id));
    for (const row of rows) {
      if (row.status === status) continue;
      const problem = checkTransition(
        status,
        facts.get(row.id) ?? {
          hasApprovedDraft: false,
          hasSentDraft: false,
          hasConfirmedPlacement: false,
        },
      );
      if (problem)
        throw new OpportunityRefusal(`${row.referringDomain}: ${problem}`);
    }
  }
  if (campaignMode === "earned_editorial" || campaignMode === "partnership") {
    const sponsored = rows.find((row) => row.notes?.includes("rel=sponsored"));
    if (sponsored) {
      throw new OpportunityRefusal(
        `${sponsored.referringDomain}: its links carry rel=sponsored, so it cannot be filed as ${campaignMode === "earned_editorial" ? "earned" : "a partnership"}.`,
      );
    }
  }
  await LinkProspectRepository.applyPatch({
    projectId: ctx.projectId,
    rows,
    patch: input.patch,
    note: input.note,
    actor: actorOf(ctx),
    userId: ctx.userId,
  });
  return { updated: rows.length };
}

/**
 * Requalifies prospects from the link gap they came from, against the
 * project's current settings. Pursue and Review become Qualified; Skip becomes
 * Rejected with the reason on its history. Prospects without link gap data
 * (AI-cited, manual) are left as they are.
 */
async function qualify(ctx: LinkAcquisitionContext, ids: string[]) {
  const rows = await LinkProspectRepository.getMany(ctx.projectId, ids);
  const byRun = new Map<string, LinkProspectRecord[]>();
  const skippedNoData: string[] = [];
  for (const row of rows) {
    if (!row.sourceRunId || row.status !== "discovered") {
      skippedNoData.push(row.referringDomain);
      continue;
    }
    byRun.set(row.sourceRunId, [...(byRun.get(row.sourceRunId) ?? []), row]);
  }
  let qualified = 0;
  let rejected = 0;
  for (const [runId, prospects] of byRun) {
    const loaded = await LinkGapService.loadScored(ctx.projectId, runId);
    for (const prospect of prospects) {
      const scored = loaded?.rows.find(
        (row) => row.referringDomain === prospect.referringDomain,
      );
      if (!scored) {
        skippedNoData.push(prospect.referringDomain);
        continue;
      }
      const skip = scored.qualification.recommendation === "skip";
      await LinkProspectRepository.applyPatch({
        projectId: ctx.projectId,
        rows: [prospect],
        patch: {
          status: skip ? "rejected" : "qualified",
          recommendation: scored.qualification.recommendation,
          score: Math.round(scored.qualification.score),
        },
        note: skip
          ? `Skip recommended: ${scored.qualification.whyRealistic}`
          : `Qualified: ${scored.qualification.nextAction}`,
        actor: actorOf(ctx),
        userId: ctx.userId,
      });
      if (skip) rejected += 1;
      else qualified += 1;
    }
  }
  return { qualified, rejected, notChanged: skippedNoData.length };
}

/** Re-runs asset matching for prospects that do not have a target page yet. */
async function matchAssets(ctx: LinkAcquisitionContext, ids: string[]) {
  const rows = (
    await LinkProspectRepository.getMany(ctx.projectId, ids)
  ).filter((row) => !row.targetUrl);
  if (rows.length === 0) return { matched: 0, needAsset: 0, unknown: 0 };
  const ownPages = await LinkProspectRepository.ownPages(ctx.projectId);
  const evidence = await LinkGapRepository.evidenceForDomains(
    ctx.projectId,
    rows.map((row) => row.referringDomain),
  );
  let matched = 0;
  let needAsset = 0;
  let unknown = 0;
  for (const row of rows) {
    const match = matchAsset({
      competitorDestinations: evidence
        .filter((item) => item.referringDomain === row.referringDomain)
        .map((item) => ({ url: item.urlTo, title: null })),
      ownPages,
    });
    if (match.kind === "existing") {
      matched += 1;
      await LinkProspectRepository.applyPatch({
        projectId: ctx.projectId,
        rows: [row],
        patch: { targetUrl: match.url },
        actor: actorOf(ctx),
        userId: ctx.userId,
      });
    } else if (match.kind === "none") needAsset += 1;
    else unknown += 1;
  }
  return { matched, needAsset, unknown };
}

/**
 * The page a prospect needs does not exist: store it as an opportunity (the
 * same table Opportunities lists) and, when asked, start a Content Studio
 * brief. Reuses an existing target page whenever one matches, and refuses
 * otherwise-needless briefs.
 */
async function createAssetOpportunity(
  ctx: LinkAcquisitionContext,
  input: { prospectId: string; withBrief: boolean },
) {
  const prospect = await LinkProspectRepository.getOne(
    ctx.projectId,
    input.prospectId,
  );
  if (!prospect) throw new OpportunityRefusal("That prospect was not found.");
  if (prospect.targetUrl) {
    throw new OpportunityRefusal(
      `This prospect already points to ${prospect.targetUrl}. Use that page instead of writing a new one.`,
    );
  }
  const evidence = await LinkGapRepository.evidenceForDomains(ctx.projectId, [
    prospect.referringDomain,
  ]);
  const ownPages = await LinkProspectRepository.ownPages(ctx.projectId);
  const match = matchAsset({
    competitorDestinations: evidence.map((item) => ({
      url: item.urlTo,
      title: null,
    })),
    ownPages,
  });
  if (match.kind === "existing") {
    throw new OpportunityRefusal(
      `${match.url} already covers this. Set it as the target page instead of writing a new one.`,
    );
  }
  if (match.kind === "unknown" || !match.topic) {
    throw new OpportunityRefusal(
      `A new page cannot be justified yet: ${match.reason}`,
    );
  }
  const now = new Date().toISOString();
  const candidate: OpportunityCandidate = {
    dedupeKey: `link_prospect::${prospect.dedupeKey}`,
    query: match.topic,
    pageUrl: null,
    action: "new_article",
    reason: `${prospect.referringDomain} links to competitors on "${match.topic}" and this project has no page on it. ${match.reason}`,
    matchedCollectionHandle: null,
    dataSource: "competitor",
    intent: null,
    priority: "medium",
    priorityReason:
      "A page for a topic competitors earn links on. Link prospects need it as a target; no traffic estimate is implied.",
    observedAt: now,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    position: 0,
    windowStart: now.slice(0, 10),
    windowEnd: now.slice(0, 10),
    evidence: [
      {
        source: PROVIDER,
        label: "Link prospect",
        value: `${prospect.referringDomain} links to competitors`,
        url: null,
        observedAt: now,
      },
      ...evidence.slice(0, 5).map((item) => ({
        source: PROVIDER,
        label: "Competitor destination",
        value: item.urlTo,
        url: item.urlFrom,
        observedAt: item.collectedAt,
      })),
    ],
  };
  const opportunityId = await OpportunityRepository.upsertCandidate(
    { projectId: ctx.projectId, organizationId: ctx.organizationId },
    candidate,
  );
  await LinkProspectRepository.applyPatch({
    projectId: ctx.projectId,
    rows: [prospect],
    patch: { contentOpportunityId: opportunityId },
    actor: actorOf(ctx),
    userId: ctx.userId,
  });
  const asset = input.withBrief
    ? await ContentService.createBriefAndDraft(
        {
          projectId: ctx.projectId,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        },
        opportunityId,
      )
    : null;
  return { opportunityId, topic: match.topic, asset };
}

export const LinkProspectService = {
  saveFromGap,
  saveManual,
  aiCitedSources,
  saveFromAiCitations,
  list,
  detail,
  update,
  qualify,
  matchAssets,
  createAssetOpportunity,
};
