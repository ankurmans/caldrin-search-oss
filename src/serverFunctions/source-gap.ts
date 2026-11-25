import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import {
  analyzePrompt,
  createSourceGapOpportunity,
  getLatestAnalysis,
  getTopicOverview,
  listAnalysisSummaries,
  setOwnerPage,
  SourceGapRefusal,
} from "@/server/features/source-gap/sourceGapService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { aiProjectSchema } from "@/types/schemas/ai-visibility";
import {
  sourceGapAnalyzeSchema,
  sourceGapOpportunitySchema,
  sourceGapOwnerSchema,
  sourceGapPromptSchema,
} from "@/types/schemas/source-gap";

// Reads stored answers and fetches the pages they cited; no AI query is run.
export const analyzeSourceGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceGapAnalyzeSchema)
  .handler(async ({ data, context }) => {
    try {
      const analysis = await analyzePrompt(
        {
          projectId: context.projectId,
          organizationId: context.organizationId,
        },
        { ...data, projectId: context.projectId },
      );
      return { ok: true as const, data: analysis };
    } catch (error) {
      if (error instanceof SourceGapRefusal)
        return { ok: false as const, reason: error.message };
      throw error;
    }
  });

export const getSourceGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceGapPromptSchema)
  .handler(({ data, context }) =>
    getLatestAnalysis({ ...data, projectId: context.projectId }),
  );

export const listSourceGaps = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) => listAnalysisSummaries(context.projectId));

export const getSourceGapTopics = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) => getTopicOverview(context.projectId));

export const setSourceGapOwner = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceGapOwnerSchema)
  .handler(async ({ data, context }) => {
    try {
      await setOwnerPage({ ...data, projectId: context.projectId });
      return { ok: true as const };
    } catch (error) {
      if (error instanceof SourceGapRefusal)
        return { ok: false as const, reason: error.message };
      throw error;
    }
  });

export const createSourceGapOpportunityFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceGapOpportunitySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    try {
      const result = await createSourceGapOpportunity(
        {
          projectId: context.projectId,
          organizationId: context.organizationId,
        },
        { analysisId: data.analysisId },
      );
      return { ok: true as const, data: result };
    } catch (error) {
      if (error instanceof OpportunityRefusal)
        return { ok: false as const, reason: error.message };
      throw error;
    }
  });
