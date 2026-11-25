import { z } from "zod";
import { createDataforseoBillingClassifier } from "@/server/lib/dataforseoBillingClassification";
import { dataforseoPost } from "@/server/lib/dataforseo/core";
import {
  assertOk,
  buildTaskBilling,
  parseTaskItems,
  parseTaskTotalCount,
} from "@/server/lib/dataforseo/envelope";

const PATH = "/v3/backlinks/domain_intersection/live";

const classifyError = createDataforseoBillingClassifier({
  pathPrefix: "/backlinks/",
  billingIssueCode: "BACKLINKS_BILLING_ISSUE",
  billingIssueMessage:
    "The connected DataForSEO account has a billing or balance issue",
});

export const LINK_GAP_DEFAULT_LIMIT = 100;

// Per target, the provider returns aggregates for one referring domain. The
// `target` field inside each entry is the referring domain, not the queried
// competitor; the competitor is the entry's key.
const intersectionTargetSchema = z
  .object({
    target: z.string().nullable().optional(),
    rank: z.number().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    referring_pages: z.number().nullable().optional(),
    referring_pages_nofollow: z.number().nullable().optional(),
    first_seen: z.string().nullable().optional(),
    lost_date: z.string().nullable().optional(),
    backlinks_spam_score: z.number().nullable().optional(),
    broken_backlinks: z.number().nullable().optional(),
    referring_links_attributes: z
      .record(z.string(), z.number().nullable())
      .nullable()
      .optional(),
    referring_links_types: z
      .record(z.string(), z.number().nullable())
      .nullable()
      .optional(),
    referring_links_platform_types: z
      .record(z.string(), z.number().nullable())
      .nullable()
      .optional(),
    referring_links_semantic_locations: z
      .record(z.string(), z.number().nullable())
      .nullable()
      .optional(),
  })
  .passthrough();

export const domainIntersectionItemSchema = z
  .object({
    domain_intersection: z.record(z.string(), intersectionTargetSchema),
    summary: z
      .object({ intersections_count: z.number().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type DomainIntersectionItem = z.infer<
  typeof domainIntersectionItemSchema
>;

type BacklinksIntersectionRequest = {
  /** Competitor hosts; their position + 1 is the provider's key for each. */
  targets: string[];
  /** Hosts whose referring domains are removed, e.g. the user's own site. */
  excludeTargets: string[];
  /** "all" = links to every target; "partial" = links to at least one. */
  mode: "all" | "partial";
  status: "live" | "lost" | "all";
  includeSubdomains: boolean;
  limit?: number;
  offset?: number;
  orderBy?: string[];
  filters?: unknown[];
};

/**
 * Referring domains shared between up to five competitors, minus the
 * excluded targets. The result is aggregated per referring domain, so it can
 * rank prospects but cannot name the linking page or the destination URL.
 */
export async function fetchBacklinksDomainIntersection(
  input: BacklinksIntersectionRequest,
) {
  const targets = Object.fromEntries(
    input.targets.map((target, index) => [String(index + 1), target]),
  );
  const response = await dataforseoPost(
    PATH,
    [
      {
        targets,
        exclude_targets:
          input.excludeTargets.length > 0 ? input.excludeTargets : undefined,
        intersection_mode: input.mode,
        include_subdomains: input.includeSubdomains,
        include_indirect_links: true,
        exclude_internal_backlinks: true,
        backlinks_status_type: input.status,
        rank_scale: "one_thousand",
        limit: input.limit ?? LINK_GAP_DEFAULT_LIMIT,
        offset: input.offset,
        order_by: input.orderBy,
        ...(input.filters && input.filters.length > 0
          ? { filters: input.filters }
          : {}),
      },
    ],
    { classify: classifyError },
  );
  const task = assertOk(response, {
    classify: classifyError,
    classifyPath: PATH,
  });
  return {
    data: {
      items: parseTaskItems(
        "backlinks-domain-intersection",
        task,
        domainIntersectionItemSchema,
      ),
      totalCount: parseTaskTotalCount(task),
    },
    billing: buildTaskBilling(task),
  };
}
