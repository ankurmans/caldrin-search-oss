import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { OpportunityEngineService } from "@/server/features/opportunities/services/OpportunityEngineService";
import { KeywordGapService } from "@/server/features/opportunities/services/KeywordGapService";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectScoped = z.object({ projectId: z.string().min(1) });
const listSchema = projectScoped.extend({
  intent: z
    .enum(["informational", "commercial", "transactional", "navigational"])
    .optional(),
  action: z
    .enum([
      "new_article",
      "refresh_existing_page",
      "update_collection_page",
      "improve_title_and_meta",
      "create_page",
      "improve_internal_links",
      "technical_fix",
      "earn_third_party_coverage",
      "review_brand_information",
      "no_action",
    ])
    .optional(),
  status: z.enum(["open", "briefed", "dismissed"]).optional(),
  source: z
    .enum([
      "gsc",
      "simulated",
      "dataforseo",
      "serp",
      "competitor",
      "shopify",
      "site_audit",
      "ai_visibility",
      "claim_correction",
      "attribution",
    ])
    .optional(),
});
const idSchema = projectScoped.extend({ opportunityId: z.string().min(1) });
const statusSchema = idSchema.extend({
  status: z.enum(["open", "briefed", "dismissed"]),
});

export type OpportunityResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

async function run<T>(fn: () => Promise<T>): Promise<OpportunityResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (
      error instanceof OpportunityRefusal ||
      error instanceof SpendLimitRefusal
    ) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

export const getSearchOpportunities = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listSchema)
  .handler(async ({ data, context }) =>
    OpportunityEngineService.list(context.projectId, {
      intent: data.intent,
      action: data.action,
      status: data.status,
      source: data.source,
    }),
  );

export const getSearchOpportunity = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(idSchema)
  .handler(async ({ data, context }) =>
    OpportunityEngineService.getDetail(context.projectId, data.opportunityId),
  );

// Read-only: what a paid competitor keyword-gap run would cost and whether it
// can run at all. Makes no provider call.
export const estimateKeywordGapRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return KeywordGapService.estimate({
      projectId: context.projectId,
      organizationId: context.organizationId,
      userId: context.userId,
      userEmail: context.userEmail,
    });
  });

// Free rules by default. allowPaid adds the paid keyword-gap rule: managers
// only, and the service re-checks DataForSEO access for this workspace, the
// project's spend limits and the estimate before any provider call.
export const runSearchOpportunityEngine = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      allowPaid: z.boolean().optional(),
      repeatPaid: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const scope = {
      projectId: context.projectId,
      organizationId: context.organizationId,
      userId: context.userId,
    };
    if (data.allowPaid === true) {
      return run(() =>
        KeywordGapService.runWithPaid(
          { ...scope, userEmail: context.userEmail },
          { repeat: data.repeatPaid === true },
        ),
      );
    }
    return run(() => OpportunityEngineService.run(scope));
  });

export const setSearchOpportunityStatus = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(statusSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      OpportunityEngineService.setStatus(
        context.projectId,
        data.opportunityId,
        data.status,
      ),
    );
  });
