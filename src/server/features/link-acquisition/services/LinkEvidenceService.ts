import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { ProviderHealthService } from "@/server/features/provider-health/services/ProviderHealthService";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { backlinksReadUsd } from "@/shared/backlinks-cost";
import type { z } from "zod";
import type { linkEvidenceInputSchema } from "@/types/schemas/link-acquisition";
import { LinkGapRepository } from "../repositories/LinkGapRepository";
import { evidenceFromBacklink } from "../rules/evidence";
import {
  accessRefusal,
  usd,
  type LinkAcquisitionContext,
} from "./linkAcquisitionShared";

type EvidenceInput = z.infer<typeof linkEvidenceInputSchema>;

const PROVIDER = "dataforseo";
const OPERATION = "link_gap_evidence";
// Enough pages to show how a site links, few enough to keep the read cheap.
const PAGES_PER_READ = 5;

/**
 * The intersection only reports counts per referring domain. The exact linking
 * pages come from one backlinks read per (domain, competitor) pair, started by
 * the user and priced up front.
 */
async function plan(
  ctx: LinkAcquisitionContext,
  input: EvidenceInput,
  options: { includeSubdomains?: boolean } = {},
) {
  const gapRun = await LinkGapRepository.getRun(ctx.projectId, input.runId);
  if (!gapRun) {
    throw new OpportunityRefusal("That link gap run was not found.");
  }
  const wanted = new Set(input.domains.map((d) => d.toLowerCase()));
  const candidates = (
    await LinkGapRepository.candidatesOfRun(ctx.projectId, gapRun.id)
  ).filter((candidate) => wanted.has(candidate.referringDomain));
  const reads = candidates.flatMap((candidate) =>
    candidate.competitors.map((competitor) => ({
      domain: candidate.referringDomain,
      competitor: competitor.competitorDomain,
    })),
  );
  return {
    gapRun,
    reads,
    domains: candidates.length,
    includeSubdomains: options.includeSubdomains ?? gapRun.includeSubdomains,
    estimatedUsd: reads.length * backlinksReadUsd(PAGES_PER_READ),
  };
}

async function estimate(ctx: LinkAcquisitionContext, input: EvidenceInput) {
  const quote = await plan(ctx, input);
  const noAccess = await accessRefusal(ctx.organizationId);
  const remaining = await SpendService.getRemainingUsd(ctx.projectId);
  const overLimit = !!remaining && quote.estimatedUsd > remaining.usd;
  return {
    available: quote.reads.length > 0 && !noAccess && !overLimit,
    reason:
      noAccess ??
      (quote.reads.length === 0
        ? "None of those domains are in this run."
        : overLimit
          ? `The estimated cost of ${usd(quote.estimatedUsd)} would pass this project's spend limit.`
          : null),
    providerReads: quote.reads.length,
    domains: quote.domains,
    estimatedUsd: quote.estimatedUsd,
    basis: `${quote.reads.length} DataForSEO backlinks read${quote.reads.length === 1 ? "" : "s"}, up to ${PAGES_PER_READ} linking pages each.`,
  };
}

async function run(ctx: LinkAcquisitionContext, input: EvidenceInput) {
  const quote = await estimate(ctx, input);
  if (!quote.available) {
    throw new OpportunityRefusal(
      `${quote.reason ?? "Evidence is not available."} Nothing was fetched.`,
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
  const { reads, includeSubdomains } = await plan(ctx, input);
  const client = createDataforseoClient(ctx);
  const collectedAt = new Date().toISOString();
  const perRead = backlinksReadUsd(PAGES_PER_READ);
  const rows = [];
  let succeeded = 0;
  for (const read of reads) {
    try {
      const page = await client.backlinks.rows({
        target: read.competitor,
        includeSubdomains,
        status: "live",
        mode: "as_is",
        limit: PAGES_PER_READ,
        hideSpam: false,
        filters: ["domain_from", "in", [read.domain, `www.${read.domain}`]],
      });
      for (const item of page.items) {
        const evidence = evidenceFromBacklink(item, {
          projectId: ctx.projectId,
          competitorDomain: read.competitor,
          collectedAt,
        });
        if (evidence) rows.push(evidence);
      }
      succeeded += 1;
    } catch (error) {
      console.error("link-gap.evidence read failed:", error);
      await ProviderHealthService.recordFailure("link_evidence", error, scope);
    }
  }
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
      "Every provider read failed, so no evidence was saved. Nothing was charged.",
    );
  }
  await LinkGapRepository.saveEvidence(rows);
  return {
    evidenceRows: rows.length,
    costUsd,
    partial: succeeded < reads.length,
  };
}

export const LinkEvidenceService = { estimate, run };
