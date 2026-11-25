import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { AiVisibilityService } from "@/server/features/ai-visibility/services/AiVisibilityService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { generateAiPromptsSchema } from "@/types/schemas/aiPromptSuggestions";
import { researchAiPromptsSchema } from "@/types/schemas/aiPromptResearch";
import {
  aiProjectSchema,
  removeAiResearchKeywordSchema,
  saveAiTrackerSchema,
  estimateAiCostSchema,
  setAiScheduleSchema,
  runAiCheckSchema,
  setAiMarketsSchema,
  getAiRunSchema,
  aiPageResultsSchema,
  aiSourcesSchema,
  aiAnswerSchema,
  aiExportSchema,
  aiTrendSchema,
} from "@/types/schemas/ai-visibility";
import {
  aiEvidencePageSchema,
  aiIntelligenceSchema,
} from "@/types/schemas/ai-visibility-intelligence";

export const generateAiVisibilityPrompts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(generateAiPromptsSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.generatePrompts(
      { ...data, projectId: context.projectId },
      context,
    ),
  );

export const researchAiVisibilityPrompts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(researchAiPromptsSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.researchPrompts(
      { ...data, projectId: context.projectId },
      context,
    ),
  );

export const getAiResearchSetup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) =>
    AiVisibilityService.getResearchSetup({ projectId: context.projectId }),
  );

export const startAiResearchSetup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) =>
    AiVisibilityService.startResearchSetup(
      { projectId: context.projectId },
      context,
      { runSeededTracking: true },
    ),
  );

export const listAiResearchKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) =>
    AiVisibilityService.listResearchKeywords({ projectId: context.projectId }),
  );

export const removeAiResearchKeyword = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(removeAiResearchKeywordSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.removeResearchKeyword({
      projectId: context.projectId,
      keyword: data.keyword,
    }),
  );

export const getAiVisibilityTracker = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) =>
    AiVisibilityService.getTracker({ projectId: context.projectId }),
  );

export const saveAiVisibilityTracker = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(saveAiTrackerSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.saveTracker({ ...data, projectId: context.projectId }),
  );

export const estimateAiVisibilityCost = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(estimateAiCostSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.estimateCost({ ...data, projectId: context.projectId }),
  );

export const setAiVisibilitySchedule = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setAiScheduleSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.setSchedule(
      { ...data, projectId: context.projectId },
      context,
    ),
  );

export const setAiVisibilityMarkets = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setAiMarketsSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.setMarkets({ ...data, projectId: context.projectId }),
  );

export const runAiVisibilityCheck = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(runAiCheckSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.runCheck(
      { ...data, projectId: context.projectId },
      context,
    ),
  );

export const getAiVisibilityRun = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getAiRunSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getRun({ ...data, projectId: context.projectId }),
  );

export const getAiVisibilityResults = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiPageResultsSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getPageResults({
      ...data,
      projectId: context.projectId,
    }),
  );

export const getAiVisibilitySources = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiSourcesSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getSources({ ...data, projectId: context.projectId }),
  );

export const getAiVisibilityTrend = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiTrendSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getTrend({ ...data, projectId: context.projectId }),
  );

export const getAiVisibilityIntelligence = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiIntelligenceSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getIntelligence({
      ...data,
      projectId: context.projectId,
    }),
  );

export const getAiVisibilityEvidencePage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiEvidencePageSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getEvidencePage({
      ...data,
      projectId: context.projectId,
    }),
  );

export const getAiVisibilityAnswer = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiAnswerSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.getAnswer({ ...data, projectId: context.projectId }),
  );

export const exportAiVisibilityData = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiExportSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.exportData(
      { ...data, projectId: context.projectId },
      getPublicOrigin(getRequest()),
    ),
  );

export const lookupAiPromptVolume = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) =>
    AiVisibilityService.lookupPromptVolumes(
      { projectId: context.projectId },
      context,
    ),
  );

export const classifyAiVisibilitySentiment = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getAiRunSchema)
  .handler(({ data, context }) =>
    AiVisibilityService.classifySentiment(
      { projectId: context.projectId, runId: data.runId },
      context,
    ),
  );
