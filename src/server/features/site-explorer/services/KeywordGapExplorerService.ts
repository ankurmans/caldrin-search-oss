/* eslint-disable max-lines -- the paid run, its cost preview and the row decisions share one set of provider and spend rules */
import { ContentService } from "@/server/features/content/services/ContentService";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { getWorkspaceMode } from "@/server/features/workspace/credentials";
import type { CustomerContext } from "@/server/lib/customer-context";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import { hasDataforseoAccess } from "@/server/lib/provider-access";
import type {
  KeywordGapQuery,
  KeywordGapRunInput,
} from "@/types/schemas/keyword-gap";
import { MAX_GAP_COMPETITORS } from "@/types/schemas/keyword-gap";
import type { ContextAuthor } from "@/types/schemas/projectContext";
import { candidateFromGapRow, type GapRowForAction } from "../rules/gapAction";
import {
  mergeGapReads,
  normaliseDomain,
  type GapRead,
} from "../rules/gapMerge";
import { likelyPageType } from "../rules/pageType";
import {
  KeywordGapRepository,
  type RunCompetitorRecord,
} from "../repositories/KeywordGapRepository";

export type ExplorerContext = CustomerContext & {
  projectId: string;
  actor?: ContextAuthor;
};

const GAP_PROVIDER = "dataforseo";
const GAP_OPERATION = "site_explorer_keyword_gap";
const MAX_EXPORT_ROWS = 5000;
const VOLUME_ORDER = ["keyword_data.keyword_info.search_volume,desc"];

const usd = (n: number) => `$${n.toFixed(2)}`;

type GapEstimate = {
  available: boolean;
  reason: string | null;
  target: string | null;
  competitors: string[];
  locationCode: number;
  languageCode: string;
  rowsPerCompetitor: number;
  includeOutranked: boolean;
  providerReads: number;
  estimatedUsd: number | null;
  basis: string | null;
  remainingUsd: number | null;
  limitPeriod: "daily" | "monthly" | null;
  ranToday: { at: string; costUsd: number } | null;
};

async function accessRefusal(organizationId: string): Promise<string | null> {
  if (await hasDataforseoAccess()) return null;
  return (await getWorkspaceMode(organizationId)) === "byok"
    ? "This workspace uses its own provider keys and has no DataForSEO key saved. Add one in Settings to run a keyword gap."
    : "DataForSEO is not set up for this workspace, so a keyword gap cannot run.";
}

// Resolves the target, the competitors and the market from the request and the
// project, without touching the provider.
async function resolveInputs(ctx: ExplorerContext, input: KeywordGapRunInput) {
  const [project, saved] = await Promise.all([
    OpportunityRepository.getProjectBrand(ctx.projectId),
    KeywordGapRepository.listCompetitorsWithMarkets(ctx.projectId),
  ]);
  const target = project?.domain ? normaliseDomain(project.domain) : null;
  const requested = input.competitors.map((raw) => ({
    raw,
    domain: normaliseDomain(raw),
  }));
  const invalid = requested.find((entry) => entry.domain === null);
  const competitors = [
    ...new Set(
      (requested.length > 0
        ? requested.map((entry) => entry.domain)
        : saved.map((competitor) => competitor.domain)
      ).filter((domain): domain is string => !!domain && domain !== target),
    ),
  ];
  return {
    target,
    competitors,
    invalid: invalid?.raw ?? null,
    locationCode: input.locationCode ?? project?.locationCode ?? 2840,
    languageCode: input.languageCode ?? project?.languageCode ?? "en",
  };
}

async function estimate(
  ctx: ExplorerContext,
  input: KeywordGapRunInput,
): Promise<GapEstimate> {
  const resolved = await resolveInputs(ctx, input);
  const competitors = resolved.competitors.slice(0, MAX_GAP_COMPETITORS);
  const base: GapEstimate = {
    available: false,
    reason: null,
    target: resolved.target,
    competitors,
    locationCode: resolved.locationCode,
    languageCode: resolved.languageCode,
    rowsPerCompetitor: input.rowsPerCompetitor,
    includeOutranked: input.includeOutranked,
    providerReads: competitors.length * (input.includeOutranked ? 2 : 1),
    estimatedUsd: null,
    basis: null,
    remainingUsd: null,
    limitPeriod: null,
    ranToday: null,
  };
  const refuse = (reason: string, extra: Partial<GapEstimate> = {}) => ({
    ...base,
    ...extra,
    reason,
  });
  if (!resolved.target) {
    return refuse(
      "This project has no domain set, so there is nothing to compare competitors against. Set the project's domain first.",
    );
  }
  if (resolved.invalid) {
    return refuse(`"${resolved.invalid}" is not a domain.`);
  }
  if (resolved.competitors.length > MAX_GAP_COMPETITORS) {
    return refuse(
      `A keyword gap compares up to ${MAX_GAP_COMPETITORS} competitors at a time; ${resolved.competitors.length} were given. Choose ${MAX_GAP_COMPETITORS} or fewer.`,
    );
  }
  if (competitors.length === 0) {
    return refuse(
      "No competitors to compare. Save a competitor or name one, then try again.",
    );
  }
  const noAccess = await accessRefusal(ctx.organizationId);
  if (noAccess) return refuse(noAccess);

  const perRead = dataforseoPricing.domain.intersection({
    target1: "competitor.example",
    target2: resolved.target,
    intersections: false,
    locationCode: resolved.locationCode,
    languageCode: resolved.languageCode,
    limit: input.rowsPerCompetitor,
  });
  const estimatedUsd = perRead * base.providerReads;
  const earlier = await SpendService.latestToday(ctx.projectId, GAP_OPERATION);
  const found = {
    estimatedUsd,
    basis: `${base.providerReads} DataForSEO domain-intersection read${base.providerReads === 1 ? "" : "s"}, up to ${input.rowsPerCompetitor} keywords each, most-searched first. Upper bound; the provider bills per keyword actually returned.`,
    ranToday: earlier
      ? { at: earlier.createdAt, costUsd: earlier.costUsd }
      : null,
  };
  const remaining = await SpendService.getRemainingUsd(ctx.projectId);
  const limits = {
    remainingUsd: remaining?.usd ?? null,
    limitPeriod: remaining?.period ?? null,
  };
  if (remaining && estimatedUsd > remaining.usd) {
    return refuse(
      `The estimated cost of ${usd(estimatedUsd)} would pass this project's ${remaining.period} spend limit (${usd(remaining.usd)} remaining). Raise the limit in spend settings or read fewer keywords.`,
      { ...found, ...limits },
    );
  }
  return { ...base, ...found, ...limits, available: true };
}

// The paid run. Nothing here is reachable from a page load: it needs this
// call, a passing estimate, and (for a second run the same day) `repeat`.
async function run(
  ctx: ExplorerContext,
  input: KeywordGapRunInput,
  options: { repeat?: boolean } = {},
): Promise<{
  runId: string;
  rowCount: number;
  costUsd: number;
  partial: boolean;
}> {
  const quote = await estimate(ctx, input);
  if (!quote.available || quote.estimatedUsd === null || !quote.target) {
    throw new OpportunityRefusal(
      `${quote.reason ?? "The keyword gap is not available."} Nothing was fetched.`,
    );
  }
  if (quote.ranToday && !options.repeat) {
    throw new OpportunityRefusal(
      `A keyword gap already ran today for ${usd(quote.ranToday.costUsd)}. Running again is charged again, so confirm the repeat to run it. Nothing was fetched.`,
    );
  }
  const scope = {
    projectId: ctx.projectId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  };
  await SpendService.assertWithinLimits(scope, {
    estimatedUsd: quote.estimatedUsd,
    provider: GAP_PROVIDER,
    operation: GAP_OPERATION,
  });

  const client = createDataforseoClient(ctx);
  const runAt = new Date().toISOString();
  const kinds: Array<"missing" | "outranked"> = quote.includeOutranked
    ? ["missing", "outranked"]
    : ["missing"];
  const reads: GapRead[] = [];
  const coverage: RunCompetitorRecord[] = [];
  const perRead = quote.estimatedUsd / quote.providerReads;
  let succeeded = 0;
  for (const competitorDomain of quote.competitors) {
    for (const kind of kinds) {
      try {
        const page = await client.domain.intersection({
          target1: competitorDomain,
          target2: quote.target,
          intersections: kind === "outranked",
          locationCode: quote.locationCode,
          languageCode: quote.languageCode,
          limit: quote.rowsPerCompetitor,
          orderBy: VOLUME_ORDER,
        });
        reads.push({ competitorDomain, kind, items: page.items });
        coverage.push({
          competitorDomain,
          kind,
          status: "ok",
          rowsRead: page.items.length,
          providerTotal: page.totalCount,
          error: null,
        });
        succeeded += 1;
      } catch (error) {
        coverage.push({
          competitorDomain,
          kind,
          status: "failed",
          rowsRead: 0,
          providerTotal: null,
          error:
            error instanceof Error ? error.message.slice(0, 300) : "Failed",
        });
      }
    }
  }
  // Only reads that returned are charged to the project; the estimate is the
  // per-read upper bound.
  const costUsd = perRead * succeeded;
  if (costUsd > 0) {
    await SpendService.recordCost(scope, {
      provider: GAP_PROVIDER,
      operation: GAP_OPERATION,
      estimatedUsd: quote.estimatedUsd,
      costUsd,
    });
  }
  if (succeeded === 0) {
    throw new OpportunityRefusal(
      "Every provider read failed, so no keyword gap was saved. Nothing was charged.",
    );
  }
  const rows = mergeGapReads(reads, runAt);
  const runId = crypto.randomUUID();
  const partial = coverage.some((c) => c.status === "failed");
  await KeywordGapRepository.saveRun({
    run: {
      id: runId,
      projectId: ctx.projectId,
      targetDomain: quote.target,
      locationCode: quote.locationCode,
      languageCode: quote.languageCode,
      rowsPerCompetitor: quote.rowsPerCompetitor,
      includeOutranked: quote.includeOutranked,
      estimatedUsd: quote.estimatedUsd,
      costUsd,
      status: partial ? "partial" : "complete",
      createdBy: ctx.actor ?? "user",
    },
    competitors: coverage,
    rows,
    analysedDomains: coverage
      .filter((c) => c.status === "ok")
      .map((c) => c.competitorDomain),
    analysedAt: runAt,
  });
  return { runId, rowCount: rows.length, costUsd, partial };
}

async function resolveRun(projectId: string, runId: string | undefined) {
  return runId
    ? KeywordGapRepository.getRun(projectId, runId)
    : KeywordGapRepository.latestRun(projectId);
}

// What is stored for the project: reading it never calls the provider.
async function list(projectId: string, query: KeywordGapQuery) {
  const gapRun = await resolveRun(projectId, query.runId);
  if (!gapRun) return null;
  const [{ rows, total }, competitors] = await Promise.all([
    KeywordGapRepository.listRows(projectId, gapRun, query),
    KeywordGapRepository.runCompetitors(gapRun.id),
  ]);
  return {
    run: gapRun,
    competitors,
    total,
    rows: rows.map((row) => ({
      ...row,
      likelyPageType: likelyPageType(row.bestUrl),
    })),
  };
}

async function exportRows(projectId: string, query: KeywordGapQuery) {
  const gapRun = await resolveRun(projectId, query.runId);
  if (!gapRun) return null;
  const rows = await KeywordGapRepository.exportRows(
    projectId,
    gapRun,
    query,
    MAX_EXPORT_ROWS,
  );
  return {
    run: gapRun,
    rows: rows.map((row) => ({
      ...row,
      likelyPageType: likelyPageType(row.bestUrl),
    })),
  };
}

async function listRuns(projectId: string) {
  return KeywordGapRepository.listRuns(projectId, 20);
}

// Watch, dismiss, restore, or attach a target page, for rows of one run. The
// decision is stored against the keyword and market, so it survives a re-run.
async function decide(
  ctx: ExplorerContext,
  input: {
    runId: string;
    rowIds: string[];
    patch: {
      status?: "active" | "watching" | "dismissed";
      targetPageUrl?: string | null;
    };
  },
): Promise<number> {
  const gapRun = await KeywordGapRepository.getRun(ctx.projectId, input.runId);
  if (!gapRun)
    throw new OpportunityRefusal("That keyword gap run was not found.");
  const rows = await KeywordGapRepository.getRowsByIds(
    ctx.projectId,
    gapRun,
    input.rowIds,
  );
  if (rows.length === 0) return 0;
  await KeywordGapRepository.setDecision({
    projectId: ctx.projectId,
    keywords: rows.map((row) => row.keyword),
    locationCode: gapRun.locationCode,
    languageCode: gapRun.languageCode,
    patch: input.patch,
    updatedBy: ctx.actor ?? "user",
  });
  return rows.length;
}

function brandTermsFor(project: {
  name: string;
  brandName: string | null;
  domain: string | null;
}): string[] {
  const label = project.domain
    ? (normaliseDomain(project.domain)?.split(".")[0] ?? null)
    : null;
  return [project.brandName, project.name, label].filter(
    (term): term is string => !!term && term.trim().length > 1,
  );
}

// Stores an opportunity for one keyword through the same table the opportunity
// engine uses, so it appears in Opportunities with its evidence. A keyword
// that already has one is updated, not duplicated.
async function createOpportunity(
  ctx: ExplorerContext,
  input: { runId: string; rowId: string },
): Promise<{ opportunityId: string; keyword: string; action: string }> {
  const gapRun = await KeywordGapRepository.getRun(ctx.projectId, input.runId);
  if (!gapRun)
    throw new OpportunityRefusal("That keyword gap run was not found.");
  const [row] = await KeywordGapRepository.getRowsByIds(ctx.projectId, gapRun, [
    input.rowId,
  ]);
  if (!row) throw new OpportunityRefusal("That keyword was not found.");
  const project = await OpportunityRepository.getProjectBrand(ctx.projectId);
  if (!project) throw new OpportunityRefusal("Project not found.");
  const forAction: GapRowForAction = row;
  const result = candidateFromGapRow(forAction, {
    locationCode: gapRun.locationCode,
    brandTerms: brandTermsFor(project),
    store: null,
    targetPageUrl: row.targetPageUrl,
  });
  if (!result.ok) throw new OpportunityRefusal(result.reason);
  const opportunityId = await OpportunityRepository.upsertCandidate(
    { projectId: ctx.projectId, organizationId: ctx.organizationId },
    result.candidate,
  );
  await KeywordGapRepository.setDecision({
    projectId: ctx.projectId,
    keywords: [row.keyword],
    locationCode: gapRun.locationCode,
    languageCode: gapRun.languageCode,
    patch: { opportunityId },
    updatedBy: ctx.actor ?? "user",
  });
  return {
    opportunityId,
    keyword: row.keyword,
    action: result.candidate.action,
  };
}

// An opportunity, then a Content Studio brief and draft for it. The studio
// needs a connected store; without one it refuses and the opportunity stays.
async function createBrief(
  ctx: ExplorerContext,
  input: { runId: string; rowId: string },
) {
  const created = await createOpportunity(ctx, input);
  const asset = await ContentService.createBriefAndDraft(
    {
      projectId: ctx.projectId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    },
    created.opportunityId,
  );
  return { ...created, asset };
}

export const KeywordGapExplorerService = {
  estimate,
  run,
  list,
  exportRows,
  listRuns,
  decide,
  createOpportunity,
  createBrief,
};
