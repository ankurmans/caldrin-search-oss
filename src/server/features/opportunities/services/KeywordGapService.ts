import type { CustomerContext } from "@/server/lib/customer-context";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { estimateOperation } from "@/server/features/spend/services/estimateOperation";
import { getWorkspaceMode } from "@/server/features/workspace/credentials";
import { hasDataforseoAccess } from "@/server/lib/provider-access";
import { createDataForSeoKeywordSource } from "../adapters/DataForSeoKeywordSource";
import { PAID_OPERATION } from "../rules/paidGuard";
import { MAX_COMPETITORS, ROWS_PER_COMPETITOR } from "../rules/keywordGapPlan";
import { OpportunityRepository } from "../repositories/OpportunityRepository";
import { OpportunityRefusal, type RunSummary } from "../types";
import { OpportunityEngineService } from "./OpportunityEngineService";

export type KeywordGapContext = CustomerContext & { projectId: string };

// The answer shown before a paid run. When `available` is false, `reason` says
// exactly why and nothing can be run; the other fields are still filled in
// where they are known, so the page can show what the run would have cost.
export type KeywordGapEstimate = {
  available: boolean;
  reason: string | null;
  competitorDomains: string[];
  estimatedUsd: number | null;
  basis: string | null;
  remainingUsd: number | null;
  limitPeriod: "daily" | "monthly" | null;
  // Set when this project already paid for a keyword-gap read today: a second
  // run is charged again, so it needs an explicit repeat.
  ranToday: { at: string; costUsd: number } | null;
};

const usd = (n: number) => `$${n.toFixed(2)}`;

async function accessRefusal(organizationId: string): Promise<string | null> {
  if (await hasDataforseoAccess()) return null;
  // A BYOK workspace never falls back to the operator's key: say which case.
  return (await getWorkspaceMode(organizationId)) === "byok"
    ? "This workspace uses its own provider keys and has no DataForSEO key saved. Add one in Settings to run paid keyword gaps."
    : "DataForSEO is not set up for this workspace, so paid keyword gaps cannot run.";
}

async function estimate(ctx: KeywordGapContext): Promise<KeywordGapEstimate> {
  const base: KeywordGapEstimate = {
    available: false,
    reason: null,
    competitorDomains: [],
    estimatedUsd: null,
    basis: null,
    remainingUsd: null,
    limitPeriod: null,
    ranToday: null,
  };
  const refuse = (reason: string, extra: Partial<KeywordGapEstimate> = {}) => ({
    ...base,
    ...extra,
    reason,
  });

  const connection = await ContentRepository.getConnection(ctx.projectId);
  if (connection?.mode === "simulated") {
    return refuse(
      "This project is on demo data. Paid keyword gaps compare against live Search Console queries, so they cannot run.",
    );
  }
  const [project, competitors] = await Promise.all([
    OpportunityRepository.getProjectBrand(ctx.projectId),
    ProjectContextRepository.listCompetitors(ctx.projectId),
  ]);
  const own = project?.domain
    ?.replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    ?.toLowerCase();
  const competitorDomains = competitors
    .map((c) => c.domain)
    .filter((domain) => domain !== own)
    .slice(0, MAX_COMPETITORS);
  if (competitorDomains.length === 0) {
    return refuse(
      "No competitors are saved for this project. Save at least one competitor domain, then try again.",
    );
  }
  const noAccess = await accessRefusal(ctx.organizationId);
  if (noAccess) return refuse(noAccess, { competitorDomains });

  const { estimatedUsd, basis } = await estimateOperation({
    kind: "keyword_gap",
    competitorCount: competitorDomains.length,
    rowsPerCompetitor: ROWS_PER_COMPETITOR,
  });
  const earlier = await SpendService.latestToday(ctx.projectId, PAID_OPERATION);
  const found = {
    competitorDomains,
    estimatedUsd,
    basis,
    ranToday: earlier
      ? { at: earlier.createdAt, costUsd: earlier.costUsd }
      : null,
  };
  if (estimatedUsd === null) {
    return refuse(
      "No cost estimate could be produced, so nothing was run.",
      found,
    );
  }
  const remaining = await SpendService.getRemainingUsd(ctx.projectId);
  const limits = {
    remainingUsd: remaining?.usd ?? null,
    limitPeriod: remaining?.period ?? null,
  };
  if (remaining && estimatedUsd > remaining.usd) {
    return refuse(
      `The estimated cost of ${usd(estimatedUsd)} would pass this project's ${remaining.period} spend limit (${usd(remaining.usd)} remaining). Raise the limit in spend settings or try later.`,
      { ...found, ...limits },
    );
  }
  return { ...base, ...found, ...limits, available: true };
}

// The paid run. Refuses first on anything estimate() refuses; the engine then
// checks the limits again right before the read, so a spend that landed in
// between is still caught, and records the cost afterwards.
async function runWithPaid(
  ctx: KeywordGapContext,
  options: { repeat?: boolean } = {},
): Promise<RunSummary> {
  const quote = await estimate(ctx);
  if (!quote.available || quote.estimatedUsd === null) {
    throw new OpportunityRefusal(
      `${quote.reason ?? "Paid keyword gaps are not available."} Nothing was fetched.`,
    );
  }
  if (quote.ranToday && !options.repeat) {
    throw new OpportunityRefusal(
      `Paid keyword gaps already ran today for ${usd(quote.ranToday.costUsd)}. Running again is charged again, so confirm the repeat to run it. Nothing was fetched.`,
    );
  }
  const project = await OpportunityRepository.getProjectBrand(ctx.projectId);
  return OpportunityEngineService.run(ctx, {
    allowPaid: true,
    paid: {
      competitorDomains: quote.competitorDomains,
      estimatedUsd: quote.estimatedUsd,
      limit: ROWS_PER_COMPETITOR,
      source: createDataForSeoKeywordSource(ctx, {
        locationCode: project?.locationCode ?? 2840,
        languageCode: project?.languageCode ?? "en",
      }),
    },
    spendGate: SpendService,
    recordCost: async (scope, input) => {
      await SpendService.recordCost(scope, input);
    },
  });
}

export const KeywordGapService = { estimate, runWithPaid };
