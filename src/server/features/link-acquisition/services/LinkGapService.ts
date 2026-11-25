import { sortBy } from "remeda";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { ProviderHealthService } from "@/server/features/provider-health/services/ProviderHealthService";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import { LINK_GAP_MAX_COMPETITORS } from "@/shared/link-acquisition";
import type {
  LinkGapQuery,
  LinkGapRunInput,
} from "@/types/schemas/link-acquisition";
import { LinkGapRepository } from "../repositories/LinkGapRepository";
import { mergeLinkGapReads, type LinkGapRead } from "../rules/linkGapMerge";
import {
  qualifyCandidate,
  type QualificationSettings,
} from "../rules/qualification";
import {
  accessRefusal,
  resolveTargets,
  usd,
  type LinkAcquisitionContext,
} from "./linkAcquisitionShared";

const PROVIDER = "dataforseo";
const OPERATION = "link_gap";
const MAX_EXPORT_ROWS = 5000;

type PlannedRead = { competitors: string[]; mode: "partial" | "all" };

function plannedReads(competitors: string[], input: LinkGapRunInput) {
  const reads: PlannedRead[] = [];
  // Two or more competitors: domains linking to at least two (or all) of them.
  if (competitors.length >= 2) {
    reads.push({ competitors, mode: input.mode });
  }
  // Each competitor alone finds the domains that link to only that one.
  if (competitors.length === 1 || input.includeSingle) {
    for (const competitor of competitors) {
      reads.push({ competitors: [competitor], mode: "all" });
    }
  }
  return reads;
}

function readInput(read: PlannedRead, own: string, input: LinkGapRunInput) {
  return {
    targets: read.competitors,
    excludeTargets: [own],
    mode: read.mode,
    status: input.linkStatus,
    includeSubdomains: input.includeSubdomains,
    limit: input.rowLimit,
    // The provider accepts at most three sort rules, so five competitors
    // cannot each get one.
    orderBy: read.competitors
      .slice(0, 3)
      .map((_, index) => `${index + 1}.rank,desc`),
  };
}

type Estimate = {
  available: boolean;
  reason: string | null;
  own: string | null;
  competitors: string[];
  providerReads: number;
  rowLimit: number;
  estimatedUsd: number | null;
  basis: string | null;
  remainingUsd: number | null;
  limitPeriod: "daily" | "monthly" | null;
  ranToday: { at: string; costUsd: number } | null;
};

async function estimate(
  ctx: LinkAcquisitionContext,
  input: LinkGapRunInput,
): Promise<Estimate> {
  const resolved = await resolveTargets(ctx, input.competitors);
  const reads = resolved.own ? plannedReads(resolved.competitors, input) : [];
  const base: Estimate = {
    available: false,
    reason: null,
    own: resolved.own,
    competitors: resolved.competitors,
    providerReads: reads.length,
    rowLimit: input.rowLimit,
    estimatedUsd: null,
    basis: null,
    remainingUsd: null,
    limitPeriod: null,
    ranToday: null,
  };
  const refuse = (reason: string, extra: Partial<Estimate> = {}) => ({
    ...base,
    ...extra,
    reason,
  });
  if (!resolved.own) {
    return refuse(
      "This project has no domain set, so there is nothing to compare competitors against. Set the project's domain first.",
    );
  }
  if (resolved.invalid) return refuse(`"${resolved.invalid}" is not a domain.`);
  if (resolved.tooMany) {
    return refuse(
      `A link gap compares up to ${LINK_GAP_MAX_COMPETITORS} competitors at a time. Choose ${LINK_GAP_MAX_COMPETITORS} or fewer.`,
    );
  }
  if (resolved.competitors.length === 0) {
    return refuse(
      "No competitors to compare. Save a competitor or name one, then try again.",
    );
  }
  if (reads.length === 0) {
    return refuse("Nothing to read with these options.");
  }
  const noAccess = await accessRefusal(ctx.organizationId);
  if (noAccess) return refuse(noAccess);

  const estimatedUsd = reads.reduce(
    (sum, read) =>
      sum +
      dataforseoPricing.backlinks.domainIntersection(
        readInput(read, resolved.own ?? "", input),
      ),
    0,
  );
  const remaining = await SpendService.getRemainingUsd(ctx.projectId);
  const earlier = await SpendService.latestToday(ctx.projectId, OPERATION);
  const found = {
    estimatedUsd,
    basis: `${reads.length} DataForSEO backlinks read${reads.length === 1 ? "" : "s"}, up to ${input.rowLimit} referring domains each. Upper bound; the provider bills per row returned.`,
    ranToday: earlier
      ? { at: earlier.createdAt, costUsd: earlier.costUsd }
      : null,
    remainingUsd: remaining?.usd ?? null,
    limitPeriod: remaining?.period ?? null,
  };
  if (remaining && estimatedUsd > remaining.usd) {
    return refuse(
      `The estimated cost of ${usd(estimatedUsd)} would pass this project's ${remaining.period} spend limit (${usd(remaining.usd)} remaining). Raise the limit in spend settings or read fewer rows.`,
      found,
    );
  }
  return { ...base, ...found, available: true };
}

// The paid run. Nothing here is reachable from a page load: it needs this
// call, a passing estimate, and (for a second run the same day) `repeat`.
async function run(
  ctx: LinkAcquisitionContext,
  input: LinkGapRunInput,
  options: { repeat?: boolean } = {},
) {
  const quote = await estimate(ctx, input);
  if (!quote.available || quote.estimatedUsd === null || !quote.own) {
    throw new OpportunityRefusal(
      `${quote.reason ?? "The link gap is not available."} Nothing was fetched.`,
    );
  }
  if (quote.ranToday && !options.repeat) {
    throw new OpportunityRefusal(
      `A link gap already ran today for ${usd(quote.ranToday.costUsd)}. Running again is charged again, so confirm the repeat to run it. Nothing was fetched.`,
    );
  }
  const scope = {
    projectId: ctx.projectId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  };
  await SpendService.assertWithinLimits(scope, {
    estimatedUsd: quote.estimatedUsd,
    provider: PROVIDER,
    operation: OPERATION,
  });

  const client = createDataforseoClient(ctx);
  const observedAt = new Date().toISOString();
  const reads = plannedReads(quote.competitors, input);
  const perRead = quote.estimatedUsd / reads.length;
  const results: LinkGapRead[] = [];
  let sharedTotal: number | null = null;
  let succeeded = 0;
  for (const read of reads) {
    try {
      const page = await client.backlinks.domainIntersection(
        readInput(read, quote.own, input),
      );
      results.push({ competitors: read.competitors, items: page.items });
      if (read.competitors.length > 1) sharedTotal = page.totalCount;
      succeeded += 1;
    } catch (error) {
      console.error("link-gap.read failed:", error);
      await ProviderHealthService.recordFailure(OPERATION, error, scope);
    }
  }
  // Only reads that returned are charged; the estimate is the upper bound.
  const costUsd = perRead * succeeded;
  if (costUsd > 0) {
    await SpendService.recordCost(scope, {
      provider: PROVIDER,
      operation: OPERATION,
      estimatedUsd: quote.estimatedUsd,
      costUsd,
    });
  }
  if (succeeded === 0) {
    throw new OpportunityRefusal(
      "Every provider read failed, so no link gap was saved. Nothing was charged.",
    );
  }

  const candidates = mergeLinkGapReads(results, {
    own: quote.own,
    competitors: quote.competitors,
    runAt: observedAt,
  });
  const runId = crypto.randomUUID();
  await LinkGapRepository.saveRun({
    run: {
      id: runId,
      projectId: ctx.projectId,
      targetDomain: quote.own,
      mode: input.mode,
      includeSingle: input.includeSingle,
      linkStatus: input.linkStatus,
      includeSubdomains: input.includeSubdomains,
      rowLimit: input.rowLimit,
      providerTotal: sharedTotal,
      estimatedUsd: quote.estimatedUsd,
      costUsd,
      status: succeeded < reads.length ? "partial" : "complete",
      createdBy: ctx.actor ?? "user",
    },
    competitors: quote.competitors,
    candidates,
    observedAt,
  });
  return {
    runId,
    rowCount: candidates.length,
    costUsd,
    partial: succeeded < reads.length,
  };
}

async function loadScored(projectId: string, runId: string | undefined) {
  const gapRun = runId
    ? await LinkGapRepository.getRun(projectId, runId)
    : await LinkGapRepository.latestRun(projectId);
  if (!gapRun) return null;
  const [candidates, competitors, settings] = await Promise.all([
    LinkGapRepository.candidatesOfRun(projectId, gapRun.id),
    LinkGapRepository.runCompetitors(gapRun.id),
    LinkGapRepository.getSettings(projectId),
  ]);
  const evidence = await LinkGapRepository.evidenceForDomains(
    projectId,
    candidates.map((candidate) => candidate.referringDomain),
  );
  const rows = candidates.map((candidate) => {
    const rowEvidence = evidence.filter(
      (item) => item.referringDomain === candidate.referringDomain,
    );
    return {
      ...candidate,
      evidenceCount: rowEvidence.length,
      evidence: rowEvidence,
      qualification: qualifyCandidate({
        candidate,
        evidence: rowEvidence,
        comparedCompetitors: competitors.length,
        settings,
      }),
    };
  });
  return { run: gapRun, competitors, settings, rows };
}

type ScoredRow = NonNullable<
  Awaited<ReturnType<typeof loadScored>>
>["rows"][number];

function applyQuery(rows: ScoredRow[], query: LinkGapQuery) {
  const search = query.search?.toLowerCase();
  const filtered = rows.filter(
    (row) =>
      (!search || row.referringDomain.includes(search)) &&
      (!query.minCompetitors || row.competitorCount >= query.minCompetitors) &&
      (!query.recommendation ||
        row.qualification.recommendation === query.recommendation) &&
      (!query.competitor ||
        row.competitors.some((c) => c.competitorDomain === query.competitor)) &&
      (query.maxSpamScore === undefined ||
        (row.spamScore ?? 0) <= query.maxSpamScore) &&
      (query.minDomainRank === undefined ||
        (row.domainRank ?? -1) >= query.minDomainRank) &&
      (query.hasEvidence === undefined ||
        row.evidenceCount > 0 === query.hasEvidence),
  );
  const value = (row: ScoredRow) => {
    switch (query.sortBy) {
      case "score":
        return row.qualification.score;
      case "competitorCount":
        return row.competitorCount;
      case "domainRank":
        return row.domainRank ?? -1;
      case "spamScore":
        return row.spamScore ?? -1;
      case "firstSeen":
        return row.firstSeen ?? "";
      case "referringDomain":
        return row.referringDomain;
    }
  };
  return sortBy(filtered, [value, query.sortDir]);
}

// What is stored for the project: reading it never calls the provider.
async function list(projectId: string, query: LinkGapQuery) {
  const loaded = await loadScored(projectId, query.runId);
  if (!loaded) return null;
  const sorted = applyQuery(loaded.rows, query);
  const start = (query.page - 1) * query.pageSize;
  return {
    run: loaded.run,
    competitors: loaded.competitors,
    settings: loaded.settings,
    total: sorted.length,
    rows: sorted.slice(start, start + query.pageSize),
  };
}

async function exportRows(projectId: string, query: LinkGapQuery) {
  const loaded = await loadScored(projectId, query.runId);
  if (!loaded) return null;
  return {
    run: loaded.run,
    competitors: loaded.competitors,
    rows: applyQuery(loaded.rows, query).slice(0, MAX_EXPORT_ROWS),
  };
}

async function listRuns(projectId: string) {
  return LinkGapRepository.listRuns(projectId, 20);
}

async function saveSettings(
  ctx: LinkAcquisitionContext,
  settings: QualificationSettings,
) {
  await LinkGapRepository.saveSettings(
    ctx.projectId,
    settings,
    ctx.actor ?? "user",
  );
}

export const LinkGapService = {
  estimate,
  run,
  list,
  exportRows,
  listRuns,
  loadScored,
  settings: LinkGapRepository.getSettings,
  saveSettings,
};
