import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  analyzeCitationGaps,
  createGapOpportunity,
  loadCitationSource,
} from "@/server/features/citation-gaps/citationGapService";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  citationGapSchema,
  citationSourceSchema,
  createGapOpportunitySchema,
} from "@/types/schemas/citation-gaps";

// Reads only stored answers: no provider is called from here.
export const getCitationGaps = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(citationGapSchema)
  .handler(({ data, context }) =>
    analyzeCitationGaps({ ...data, projectId: context.projectId }),
  );

export const getCitationSource = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(citationSourceSchema)
  .handler(({ data, context }) =>
    loadCitationSource({ ...data, projectId: context.projectId }),
  );

export const createCitationGapOpportunity = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createGapOpportunitySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    try {
      const result = await createGapOpportunity(
        {
          projectId: context.projectId,
          organizationId: context.organizationId,
        },
        { ...data, projectId: context.projectId },
      );
      return { ok: true as const, data: result };
    } catch (error) {
      if (error instanceof OpportunityRefusal)
        return { ok: false as const, reason: error.message };
      throw error;
    }
  });
