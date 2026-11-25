import { loadCitationProspects } from "@/server/features/source-intelligence/services/loadCitationProspects";
import { z } from "zod";
import { FAN_OUT_LOOKUP_LIMIT } from "@/shared/fanOutKeyword";
import {
  lookUpFanOutMetrics,
  quoteFanOutMetrics,
} from "@/server/features/source-intelligence/services/fanOutKeywordMetrics";
import { createServerFn } from "@tanstack/react-start";
import { loadFanOutComparison } from "@/server/features/source-intelligence/services/loadFanOutComparison";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { analyseSourcePage } from "@/server/features/source-intelligence/services/SourcePageAnalysisService";
import { loadSourceAnalysis } from "@/server/features/source-intelligence/services/sourceAnalysisRead";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import {
  createSourceOpportunity,
  decideSource,
  loadSourceDetail,
  loadFanOutPrompts,
  loadFanOutQueryExport,
  loadFanOutAnswers,
  loadFanOutAnswer,
  saveFanOutOpportunity,
  loadSourceIntelligence,
  SourceActionRefusal,
} from "@/server/features/source-intelligence/services/SourceIntelligenceService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  sourceActionSchema,
  fanOutAnswerSchema,
  fanOutOpportunitySchema,
  sourceAnalyseSchema,
  sourceAnalysisReadSchema,
  sourceDecisionSchema,
  sourceDetailSchema,
  sourceQuerySchema,
} from "@/types/schemas/source-intelligence";

// Reads only stored answers: no provider is called from here.
export const getSourceIntelligence = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceQuerySchema)
  .handler(({ data, context }) =>
    loadSourceIntelligence({ ...data, projectId: context.projectId }),
  );

export const getFanOutComparison = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceQuerySchema.pick({ projectId: true, filters: true }))
  .handler(({ data, context }) =>
    loadFanOutComparison(context.projectId, data.filters),
  );

export const getFanOutQueryExport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    sourceQuerySchema.pick({
      projectId: true,
      filters: true,
      sortBy: true,
      sortDir: true,
    }),
  )
  .handler(({ data, context }) =>
    loadFanOutQueryExport({ ...data, projectId: context.projectId }),
  );

export const getSourceDetail = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceDetailSchema)
  .handler(({ data, context }) =>
    loadSourceDetail(context.projectId, data.filters, data.url),
  );

export const createSourceOpportunityAction = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceActionSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    try {
      const result = await createSourceOpportunity(
        {
          projectId: context.projectId,
          organizationId: context.organizationId,
        },
        data,
      );
      return { ok: true as const, data: result };
    } catch (error) {
      if (error instanceof SourceActionRefusal)
        return { ok: false as const, reason: error.message };
      throw error;
    }
  });

export const setSourceDecision = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceDecisionSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await decideSource({
      projectId: context.projectId,
      domain: data.domain,
      decision: data.decision,
      userId: context.userId,
    });
    return { ok: true as const };
  });

export const getSourceAnalysis = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceAnalysisReadSchema)
  .handler(({ data, context }) =>
    loadSourceAnalysis(context.projectId, data.url),
  );

// Without confirm this only prices the reading. With it, the page is fetched
// and summarized, checked against the project's spend limits first.
export const analyseSourcePageAction = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceAnalyseSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    try {
      const result = await analyseSourcePage(
        context,
        {
          projectId: context.projectId,
          organizationId: context.organizationId,
          userId: context.userId,
        },
        data,
      );
      return { ok: true as const, data: result };
    } catch (error) {
      if (
        error instanceof SourceActionRefusal ||
        error instanceof SpendLimitRefusal
      )
        return { ok: false as const, reason: error.message };
      throw error;
    }
  });

export const getFanOutPrompts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceQuerySchema)
  .handler(({ data, context }) =>
    loadFanOutPrompts(
      context.projectId,
      data.filters,
      data.page,
      data.pageSize,
    ),
  );

export const getFanOutAnswers = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceQuerySchema)
  .handler(({ data, context }) =>
    loadFanOutAnswers(context.projectId, data.filters, data.page),
  );

export const getFanOutAnswer = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(fanOutAnswerSchema)
  .handler(({ data, context }) =>
    loadFanOutAnswer(context.projectId, data.observationId),
  );

export const saveFanOutOpportunityAction = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(fanOutOpportunitySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    try {
      return {
        ok: true as const,
        data: await saveFanOutOpportunity(
          context,
          data.observationId,
          data.pageUrl,
        ),
      };
    } catch (error) {
      if (error instanceof SourceActionRefusal)
        return { ok: false as const, reason: error.message };
      throw error;
    }
  });

export const getCitationProspects = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceQuerySchema.pick({ projectId: true, filters: true }))
  .handler(({ data, context }) =>
    loadCitationProspects(context.projectId, data.filters),
  );

const keywordLookup = sourceQuerySchema
  .pick({ projectId: true, filters: true })
  .extend({
    terms: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(FAN_OUT_LOOKUP_LIMIT),
  });

async function readKeywordLookup<T>(work: () => Promise<T>) {
  try {
    return { ok: true as const, data: await work() };
  } catch (error) {
    if (
      error instanceof SourceActionRefusal ||
      error instanceof SpendLimitRefusal
    )
      return { ok: false as const, reason: error.message };
    throw error;
  }
}

export const quoteFanOutKeywordMetrics = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(keywordLookup)
  .handler(({ context, data }) =>
    readKeywordLookup(() => quoteFanOutMetrics(context.projectId, data)),
  );

export const lookUpFanOutKeywordMetrics = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    keywordLookup.extend({ maxEstimatedUsd: z.number().min(0).max(1) }),
  )
  .handler(({ context, data }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return readKeywordLookup(() =>
      lookUpFanOutMetrics(context, data, data.maxEstimatedUsd),
    );
  });
