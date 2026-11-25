import { estimateCost as estimateAiVisibilityCost } from "@/server/features/ai-visibility/services/aiVisibilityCost";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import { RankTrackingService } from "@/server/features/rank-tracking/services/RankTrackingService";
import { SpendService } from "./SpendService";

export type OperationEstimate = {
  // null = no estimate could be produced. Pass it to assertWithinLimits as is;
  // a project with a spend limit then refuses the operation.
  estimatedUsd: number | null;
  basis: string;
};

export type EstimableOperation =
  | { kind: "llm_draft" }
  | { kind: "rank_check"; projectId: string; configId: string }
  // One DataForSEO ranked-keywords read per competitor domain.
  | {
      kind: "keyword_gap";
      competitorCount: number;
      rowsPerCompetitor: number;
    }
  | {
      kind: "ai_visibility_check";
      projectId: string;
      promptIds?: string[];
      mode: "queued" | "live";
    };

// Thin adapter over the estimators that already exist. It never throws: a
// failing or missing estimator yields estimatedUsd null.
export async function estimateOperation(
  operation: EstimableOperation,
): Promise<OperationEstimate> {
  try {
    switch (operation.kind) {
      case "llm_draft": {
        const { estimatedUsd, basis } = SpendService.estimateLlmDraftUsd();
        return { estimatedUsd, basis };
      }
      case "keyword_gap": {
        const rawPerCompetitor = dataforseoPricing.domain.rankedKeywords({
          target: "competitor.example",
          locationCode: 2840,
          languageCode: "en",
          limit: operation.rowsPerCompetitor,
        });
        const estimatedUsd = rawPerCompetitor * operation.competitorCount;
        return {
          estimatedUsd,
          basis: `DataForSEO ranked keywords for ${operation.competitorCount} competitor ${operation.competitorCount === 1 ? "domain" : "domains"}, up to ${operation.rowsPerCompetitor} rows each.`,
        };
      }
      case "rank_check": {
        const { costUsd } = await RankTrackingService.estimateCost(
          operation.configId,
          operation.projectId,
        );
        return {
          estimatedUsd: costUsd,
          basis: "Rank tracking estimate for one check of this config.",
        };
      }
      case "ai_visibility_check": {
        const estimate = await estimateAiVisibilityCost({
          projectId: operation.projectId,
          promptIds: operation.promptIds,
        });
        return {
          estimatedUsd:
            operation.mode === "live"
              ? estimate.runNowCostUsd
              : estimate.costUsd,
          basis: `AI visibility estimate for ${estimate.observations} answers (${operation.mode}).`,
        };
      }
    }
  } catch {
    return { estimatedUsd: null, basis: "No estimate available." };
  }
}
