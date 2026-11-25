import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import type { EvidenceInput } from "@/server/features/opportunities/types";
import { DomainIntersectionService } from "@/server/features/domain/services/domainIntersection";
import type { CustomerContext } from "@/server/lib/customer-context";
import { AppError } from "@/server/lib/errors";

const SOURCE = "ai_visibility";
const MAX_COMPETING_URLS = 5;

const ORGANIC_SOURCE_LABELS = {
  rank_tracker: "Rank tracker",
  serp_read: "Stored SERP read",
  provider_keywords: "DataForSEO ranked keywords",
} as const;

type IntersectionInput = Parameters<
  typeof DomainIntersectionService.getIntersection
>[0];

/**
 * Saves one organic and AI gap as a Search Opportunity. The row is read again
 * from stored data here, never taken from the request, so the evidence and the
 * recommended action cannot be edited in transit.
 */
async function createOpportunity(
  input: IntersectionInput & { query: string; organizationId: string },
  billingCustomer: CustomerContext,
): Promise<{ opportunityId: string }> {
  const result = await DomainIntersectionService.getIntersection(
    input,
    billingCustomer,
  );
  const row = result.rows.find((candidate) => candidate.key === input.query);
  if (!row?.opportunity || !row.organic) {
    throw new AppError(
      "VALIDATION_ERROR",
      "That query is no longer a gap in the stored data.",
    );
  }
  if (!row.opportunity.ok) {
    throw new AppError("VALIDATION_ERROR", row.opportunity.reason);
  }
  const { organic, opportunity } = row;
  const now = new Date().toISOString();

  const evidence: EvidenceInput[] = [
    { source: SOURCE, label: "Query", value: row.query, observedAt: now },
    {
      source: SOURCE,
      label: `Google organic (${ORGANIC_SOURCE_LABELS[organic.source]})`,
      value:
        organic.position !== null
          ? `Position ${organic.position}`
          : `Not in the top ${organic.depth} results read`,
      url: organic.url,
      observedAt: organic.checkedAt,
    },
    ...row.answers
      .filter((answer) => answer.comparison?.comparable)
      .map((answer) => ({
        source: SOURCE,
        label: `${answer.engine.replaceAll("_", " ")} answer`,
        value: [
          answer.cited ? "cites the domain" : "does not cite the domain",
          answer.named ? "names it" : "does not name it",
          answer.recommended === null
            ? "recommendation not reported"
            : answer.recommended
              ? "recommends it"
              : "does not recommend it",
        ].join(", "),
        observedAt: answer.observedAt,
      })),
    ...row.answers
      .flatMap((answer) => answer.competingUrls)
      .filter((url, index, urls) => urls.indexOf(url) === index)
      .slice(0, MAX_COMPETING_URLS)
      .map((url) => ({
        source: SOURCE,
        label: "Cited instead",
        value: new URL(url).hostname,
        url,
      })),
  ];

  const opportunityId = await OpportunityRepository.upsertCandidate(
    { projectId: input.projectId, organizationId: input.organizationId },
    {
      dedupeKey: `intersection::${result.domain}::${row.key}`,
      query: row.query,
      pageUrl: opportunity.pageUrl,
      action: opportunity.action,
      reason: opportunity.reason,
      matchedCollectionHandle: null,
      dataSource: SOURCE,
      intent: row.prompt?.intent ? toIntent(row.prompt.intent) : null,
      priority: opportunity.priority,
      priorityReason: opportunity.reason,
      observedAt: now,
      impressions: 0,
      clicks: 0,
      ctr: 0,
      position: organic.position ?? 0,
      windowStart: organic.checkedAt ?? now,
      windowEnd: now,
      evidence,
    },
  );
  return { opportunityId };
}

function toIntent(value: string) {
  return value === "informational" ||
    value === "commercial" ||
    value === "transactional" ||
    value === "navigational"
    ? value
    : null;
}

export const DomainIntersectionOpportunityService = { createOpportunity };
