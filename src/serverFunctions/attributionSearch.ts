import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { getAiReferralIntelligence } from "@/server/features/attribution/services/attributionAiReferrals";
import { getChangeMovement } from "@/server/features/attribution/services/attributionChangeMovement";
import {
  createAttributionOpportunity,
  getAttributionFindings,
} from "@/server/features/attribution/services/attributionFindings";
import { getKeywordAssociations } from "@/server/features/attribution/services/attributionKeywords";
import { getLandingPages } from "@/server/features/attribution/services/attributionLanding";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  attributionFindingSchema,
  attributionLandingSchema,
  attributionPageSchema,
  attributionReportSchema,
} from "@/types/schemas/attribution";

export const getAttributionLandingPagesFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionLandingSchema)
  .handler(({ data, context }) =>
    getLandingPages({ ...data, projectId: context.projectId }),
  );

export const getAttributionKeywordsFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionPageSchema)
  .handler(({ data, context }) =>
    getKeywordAssociations({ ...data, projectId: context.projectId }),
  );

export const getAttributionAiReferralsFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionReportSchema)
  .handler(({ data, context }) =>
    getAiReferralIntelligence({ ...data, projectId: context.projectId }),
  );

export const getAttributionFindingsFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionReportSchema)
  .handler(({ data, context }) =>
    getAttributionFindings({ ...data, projectId: context.projectId }),
  );

export const getAttributionChangeMovementFn = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(attributionPageSchema)
  .handler(({ data, context }) =>
    getChangeMovement({ ...data, projectId: context.projectId }),
  );

export const createAttributionOpportunityFn = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(attributionFindingSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const { key, ...query } = data;
    try {
      const result = await createAttributionOpportunity(
        {
          projectId: context.projectId,
          organizationId: context.organizationId,
        },
        { ...query, projectId: context.projectId },
        key,
      );
      return { ok: true as const, data: result };
    } catch (error) {
      if (error instanceof OpportunityRefusal)
        return { ok: false as const, reason: error.message };
      throw error;
    }
  });
