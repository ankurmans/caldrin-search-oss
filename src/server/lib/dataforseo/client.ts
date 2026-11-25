import {
  assertTrialBudget,
  recordTrialSpend,
} from "@/server/features/workspace/trial";
import type { CustomerContext } from "@/server/lib/customer-context";
import {
  DataforseoChargedTaskError,
  type DataforseoApiResponse,
  invalidFieldName,
} from "@/server/lib/dataforseo/envelope";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import {
  fetchBusinessListingsSearch,
  fetchMyBusinessInfo,
  fetchQuestionsAnswers,
  postGoogleReviewsTask,
  postMyBusinessUpdatesTask,
} from "@/server/lib/dataforseo/business";
import {
  fetchBacklinksAnchors,
  fetchBacklinksHistory,
  fetchBacklinksRows,
  fetchBacklinksSummary,
  fetchDomainPagesSummary,
  fetchReferringDomains,
} from "@/server/lib/dataforseo/backlinks";
import { fetchBacklinksDomainIntersection } from "@/server/lib/dataforseo/backlinksIntersection";
import {
  fetchCompetitorsDomain,
  fetchDomainIntersection,
  fetchDomainRankOverview,
  fetchHistoricalRankOverview,
  fetchKeywordIdeas,
  fetchKeywordOverview,
  fetchKeywordSuggestions,
  fetchRankedKeywords,
  fetchRelatedKeywords,
  fetchRelevantPages,
  fetchSerpCompetitors,
} from "@/server/lib/dataforseo/labs";
import {
  fetchAdsKeywordIdeas,
  fetchAdsSearchVolume,
} from "@/server/lib/dataforseo/google-ads";
import {
  fetchLocalSerp,
  postLocalSerpTasks,
  postSerpReadTasks,
  type SerpReadsQuery,
  postRankCheckTasks,
} from "@/server/lib/dataforseo/serp";
import { fetchLighthouseResult } from "@/server/lib/dataforseo/lighthouse";
import {
  fetchLlmAggregatedMetrics,
  fetchLlmCrossAggregatedMetrics,
  fetchLlmMentionsSearch,
  fetchLlmTopPages,
  fetchLlmTopDomains,
  fetchAiKeywordVolume,
} from "@/server/lib/dataforseo/ai";
import {
  fetchAiTrackingLiveAnswer,
  postAiTrackingTasks,
} from "@/server/lib/dataforseo/ai-tracking";
import { inDataforseoSlot } from "@/server/lib/dataforseo/request-slots";
import { AppError } from "@/server/lib/errors";

/**
 * Wraps a section fetcher with trial metering. Each entry on the client is
 * `meter(customer, fetchX, dataforseoPricing.section.x)`, which returns a
 * function with the fetcher's own input type and resolves to its unwrapped
 * `.data`.
 *
 * `estimateRawUsd` is required: it is the upper bound checked against a trial
 * workspace's budget before the call, so an entry cannot be added without a
 * price (see pricing.ts).
 */
function meter<I, T>(
  customer: CustomerContext,
  fetcher: (input: I) => Promise<DataforseoApiResponse<T>>,
  estimateRawUsd: (input: I) => number,
): (input: I) => Promise<T> {
  return (input) =>
    meterDataforseoCall(customer, () => fetcher(input), estimateRawUsd(input));
}

export function createDataforseoClient(customer: CustomerContext) {
  return {
    business: {
      businessListings: meter(
        customer,
        fetchBusinessListingsSearch,
        dataforseoPricing.business.businessListings,
      ),
      questionsAnswers: meter(
        customer,
        fetchQuestionsAnswers,
        dataforseoPricing.business.questionsAnswers,
      ),
      myBusinessInfo: meter(
        customer,
        fetchMyBusinessInfo,
        dataforseoPricing.business.myBusinessInfo,
      ),
      // task_post is where DataForSEO charges; collection runs unmetered
      // through fetchBusinessDataTaskResult (see index.ts).
      reviewsTaskPost: meter(
        customer,
        postGoogleReviewsTask,
        dataforseoPricing.business.reviewsTaskPost,
      ),
      updatesTaskPost: meter(
        customer,
        postMyBusinessUpdatesTask,
        dataforseoPricing.business.updatesTaskPost,
      ),
    },
    backlinks: {
      summary: meter(
        customer,
        fetchBacklinksSummary,
        dataforseoPricing.backlinks.summary,
      ),
      rows: meter(
        customer,
        fetchBacklinksRows,
        dataforseoPricing.backlinks.rows,
      ),
      referringDomains: meter(
        customer,
        fetchReferringDomains,
        dataforseoPricing.backlinks.referringDomains,
      ),
      domainPages: meter(
        customer,
        fetchDomainPagesSummary,
        dataforseoPricing.backlinks.domainPages,
      ),
      anchors: meter(
        customer,
        fetchBacklinksAnchors,
        dataforseoPricing.backlinks.anchors,
      ),
      domainIntersection: meter(
        customer,
        fetchBacklinksDomainIntersection,
        dataforseoPricing.backlinks.domainIntersection,
      ),
      history: meter(
        customer,
        fetchBacklinksHistory,
        dataforseoPricing.backlinks.history,
      ),
    },
    keywords: {
      related: meter(
        customer,
        fetchRelatedKeywords,
        dataforseoPricing.keywords.related,
      ),
      suggestions: meter(
        customer,
        fetchKeywordSuggestions,
        dataforseoPricing.keywords.suggestions,
      ),
      ideas: meter(
        customer,
        fetchKeywordIdeas,
        dataforseoPricing.keywords.ideas,
      ),
      // Google Ads endpoints for countries Labs doesn't support.
      adsIdeas: meter(
        customer,
        fetchAdsKeywordIdeas,
        dataforseoPricing.keywords.adsIdeas,
      ),
      adsSearchVolume: meter(
        customer,
        fetchAdsSearchVolume,
        dataforseoPricing.keywords.adsSearchVolume,
      ),
    },
    domain: {
      rankOverview: meter(
        customer,
        fetchDomainRankOverview,
        dataforseoPricing.domain.rankOverview,
      ),
      historicalRankOverview: meter(
        customer,
        fetchHistoricalRankOverview,
        dataforseoPricing.domain.historicalRankOverview,
      ),
      rankedKeywords: meter(
        customer,
        fetchRankedKeywords,
        dataforseoPricing.domain.rankedKeywords,
      ),
      relevantPages: meter(
        customer,
        fetchRelevantPages,
        dataforseoPricing.domain.relevantPages,
      ),
      intersection: meter(
        customer,
        fetchDomainIntersection,
        dataforseoPricing.domain.intersection,
      ),
      competitors: meter(
        customer,
        fetchCompetitorsDomain,
        dataforseoPricing.domain.competitors,
      ),
    },
    serp: {
      // Posts each query's reads; the batch is metered together (see
      // meterDataforseoCalls). DataForSEO bills task_post, collection is free.
      // Resolves per query, in order.
      readsTaskPostBatch: (inputs: SerpReadsQuery[]) =>
        meterDataforseoCalls(
          customer,
          inputs.map((input) => () => postSerpReadTasks(input)),
          inputs.map((input) => dataforseoPricing.serp.readsTaskPost(input)),
        ),
      // Posts up to 100 queued rank check tasks; one metered charge covers the
      // whole batch (DataForSEO bills task_post at post time, collection is
      // free).
      rankCheckTaskPost: meter(
        customer,
        postRankCheckTasks,
        dataforseoPricing.serp.rankCheckTaskPost,
      ),
      local: meter(customer, fetchLocalSerp, dataforseoPricing.serp.local),
      // Live Maps searches for a Local SEO check, one per grid point; metered
      // as one batch.
      localBatch: (inputs: Parameters<typeof fetchLocalSerp>[0][]) =>
        meterDataforseoCalls(
          customer,
          inputs.map((input) => () => fetchLocalSerp(input)),
          inputs.map((input) => dataforseoPricing.serp.local(input)),
        ),
      // One queued Maps task per rank grid point; one metered charge covers
      // them all (DataForSEO bills task_post, collection is free).
      localTaskPost: meter(
        customer,
        postLocalSerpTasks,
        dataforseoPricing.serp.localTaskPost,
      ),
    },
    labs: {
      keywordOverview: meter(
        customer,
        fetchKeywordOverview,
        dataforseoPricing.labs.keywordOverview,
      ),
      serpCompetitors: meter(
        customer,
        fetchSerpCompetitors,
        dataforseoPricing.labs.serpCompetitors,
      ),
    },
    lighthouse: {
      live: meter(
        customer,
        fetchLighthouseResult,
        dataforseoPricing.lighthouse.live,
      ),
    },
    aiSearch: {
      mentionsSearch: meter(
        customer,
        fetchLlmMentionsSearch,
        dataforseoPricing.aiSearch.mentionsSearch,
      ),
      aggregatedMetrics: meter(
        customer,
        fetchLlmAggregatedMetrics,
        dataforseoPricing.aiSearch.aggregatedMetrics,
      ),
      topPages: meter(
        customer,
        fetchLlmTopPages,
        dataforseoPricing.aiSearch.topPages,
      ),
      topDomains: meter(
        customer,
        fetchLlmTopDomains,
        dataforseoPricing.aiSearch.topDomains,
      ),
      keywordVolume: meter(
        customer,
        fetchAiKeywordVolume,
        dataforseoPricing.aiSearch.keywordVolume,
      ),
      crossAggregatedMetrics: meter(
        customer,
        fetchLlmCrossAggregatedMetrics,
        dataforseoPricing.aiSearch.crossAggregatedMetrics,
      ),
      // Posts up to 100 tracked prompts for one engine. DataForSEO bills
      // task_post, so the post is where a trial workspace is charged.
      trackingTaskPost: async (
        input: Parameters<typeof postAiTrackingTasks>[0],
      ) => {
        await assertTrialBudget(
          customer.organizationId,
          dataforseoPricing.aiSearch.trackingTaskPost(input),
        );
        const response = await postAiTrackingTasks(input);
        await recordTrialSpend(
          customer.organizationId,
          response.billing.costUsd,
        );
        return response.data;
      },
      // A manual run's live answers, metered as one batch (see
      // meterDataforseoCalls). Resolves per call, in order.
      trackingLiveBatch: (
        inputs: Parameters<typeof fetchAiTrackingLiveAnswer>[0][],
      ) =>
        meterDataforseoCalls(
          customer,
          inputs.map((input) => () => fetchAiTrackingLiveAnswer(input)),
          inputs.map((input) => dataforseoPricing.aiSearch.trackingLive(input)),
        ),
    },
  } as const;
}

/**
 * The one seam every DataForSEO charge passes through. A trial workspace's
 * estimate is checked against its budget first, and what DataForSEO really
 * charged is added to it afterwards; any other workspace runs unmetered.
 * Resolves per call, in order.
 */
async function meterDataforseoCalls<T>(
  customer: CustomerContext,
  executes: Array<() => Promise<DataforseoApiResponse<T>>>,
  estimatesUsd: number[],
  onBilled?: (costUsd: number) => Promise<unknown>,
): Promise<PromiseSettledResult<T>[]> {
  if (executes.length === 0) return [];
  await assertTrialBudget(
    customer.organizationId,
    estimatesUsd.reduce((sum, usd) => sum + usd, 0),
  );

  let chargedUsd = 0;
  const results = await Promise.allSettled(
    executes.map(async (execute) => {
      try {
        const result = await execute();
        chargedUsd += result.billing.costUsd;
        return result.data;
      } catch (error) {
        // Transport / auth / upstream failure: nothing was billed.
        if (!(error instanceof DataforseoChargedTaskError)) throw error;
        // A malformed request (DataForSEO "Invalid Field: ...") that
        // DataForSEO did not bill returns no value to the customer. If
        // DataForSEO still billed us (costUsd > 0), the spend still counts.
        if (error.isInvalidField && error.billing.costUsd <= 0) {
          // Non-reportable, so this is the only record. The field name, not
          // the message, which quotes the value that was sent.
          console.warn("dataforseo.invalid-field", {
            event: "dataforseo.invalid-field",
            path: `/${error.billing.path.join("/")}`,
            field: invalidFieldName(error.message),
          });
          throw new AppError("VALIDATION_ERROR", error.message);
        }
        chargedUsd += error.billing.costUsd;
        throw error;
      }
    }),
  );
  await recordTrialSpend(customer.organizationId, chargedUsd);
  if (chargedUsd > 0 && onBilled) await onBilled(chargedUsd);
  return results;
}

export async function meterDataforseoCall<T>(
  customer: CustomerContext,
  execute: () => Promise<DataforseoApiResponse<T>>,
  estimateUsd: number,
  onBilled?: (costUsd: number) => Promise<unknown>,
): Promise<T> {
  // Cap how many single calls run at once per request (request-slots.ts).
  // Batches skip the cap: the live ones run only in Workflows, and the batch a
  // request makes posts quick tasks.
  const [result] = await meterDataforseoCalls(
    customer,
    [() => inDataforseoSlot(execute)],
    [estimateUsd],
    onBilled,
  );
  if (result.status === "rejected") throw result.reason;
  return result.value;
}
