import { getTracker } from "./aiVisibilityState";
import { saveTracker } from "./aiVisibilitySetup";
import { estimateCost } from "./aiVisibilityCost";
import { setSchedule } from "./aiVisibilitySchedule";
import { setMarkets } from "./aiVisibilityMarkets";
import { runCheck, getRun } from "./aiVisibilityRuns";
import {
  loadAiResults,
  loadAiSources,
  loadAiAnswer,
  loadAiPageResults,
} from "./aiVisibilityResults";
import { exportAiData } from "./aiVisibilityExport";
import { loadAiTrend } from "./aiVisibilityTrend";
import { loadAiIntelligence } from "./aiVisibilityIntelligence";
import { loadAiEvidencePage } from "./aiIntelligenceEvidence";
import {
  listAiResearchKeywords,
  removeAiResearchKeyword,
  researchAiPrompts,
} from "./aiPromptResearch";
import type { GenerateAiPromptsInput } from "@/types/schemas/aiPromptSuggestions";
import type { CustomerContext } from "@/server/lib/customer-context";
import type { TopCitedDomainsInput } from "@/types/schemas/ai-visibility";
import type { z } from "zod";
import type { compareWindowsToolSchema } from "./aiMeasurementSchemas";
import type { CrawlerActivityInput } from "@/types/schemas/ai-crawlers";
import type {
  getAiPerceptionSchema,
  reviewAiPerceptionSchema,
} from "@/types/schemas/ai-perception";
export const AiVisibilityService = {
  generatePrompts: async (
    input: GenerateAiPromptsInput,
    billing: CustomerContext,
  ) =>
    (await import("./aiPromptSuggestions")).generateAiPrompts(input, billing),
  getResearchSetup: async (input: { projectId: string }) =>
    (await import("./aiResearchKeywords")).getAiResearchSetup(input.projectId),
  startResearchSetup: async (
    input: { projectId: string },
    billing: CustomerContext,
    options?: { runSeededTracking?: boolean },
  ) =>
    (await import("./aiResearchKeywords")).startAiResearchSetup(
      input,
      billing,
      options,
    ),
  researchPrompts: researchAiPrompts,
  listResearchKeywords: listAiResearchKeywords,
  removeResearchKeyword: removeAiResearchKeyword,
  getTracker,
  saveTracker,
  estimateCost,
  setSchedule,
  setMarkets,
  runCheck,
  getRun,
  getResults: loadAiResults,
  getPageResults: loadAiPageResults,
  getSources: loadAiSources,
  getTrend: loadAiTrend,
  getIntelligence: loadAiIntelligence,
  getEvidencePage: loadAiEvidencePage,
  getAnswer: loadAiAnswer,
  lookupPromptVolumes: async (
    input: { projectId: string },
    billing: CustomerContext,
  ) => (await import("./aiPromptVolume")).lookupPromptVolumes(input, billing),
  topCitedDomains: async (
    input: TopCitedDomainsInput,
    billing: CustomerContext,
  ) => (await import("./aiTopCitedDomains")).topCitedDomains(input, billing),
  compareWindows: async (input: z.infer<typeof compareWindowsToolSchema>) =>
    (
      await import("./AiMeasurementService")
    ).AiMeasurementService.compareWindows(input.projectId, input),
  crawlerActivity: async (input: CrawlerActivityInput) =>
    (
      await import("@/server/features/ai-crawlers/services/aiCrawlerActivity")
    ).getCrawlerActivity(input),
  crawlerAccess: async (input: { projectId: string }) =>
    (
      await import("@/server/features/ai-crawlers/services/aiCrawlerAccess")
    ).checkCrawlerAccess(input.projectId),
  classifySentiment: async (
    input: { projectId: string; runId: string },
    billing: CustomerContext,
  ) =>
    (
      await import("@/server/features/ai-perception/services/aiPerception")
    ).classifyRunPerception(input, billing),
  getPerceptionReadings: async (input: z.infer<typeof getAiPerceptionSchema>) =>
    (
      await import("@/server/features/ai-perception/services/aiPerceptionReadings")
    ).listPerceptionReadings(input),
  reviewPerception: async (
    input: z.infer<typeof reviewAiPerceptionSchema>,
    billing: CustomerContext,
  ) =>
    (
      await import("@/server/features/ai-perception/services/aiPerception")
    ).reviewPerception(input, billing.userId ?? null),
  listBrandFacts: async (input: { projectId: string }) =>
    (
      await import("@/server/features/ai-fact-checks/services/aiFactChecks")
    ).listBrandFacts(input.projectId),
  addBrandFact: async (input: { projectId: string; statement: string }) =>
    (
      await import("@/server/features/ai-fact-checks/services/aiFactChecks")
    ).addBrandFact(input.projectId, input.statement),
  removeBrandFact: async (input: { projectId: string; factId: string }) =>
    (
      await import("@/server/features/ai-fact-checks/services/aiFactChecks")
    ).removeBrandFact(input.projectId, input.factId),
  checkBrandFacts: async (
    input: { projectId: string; runId: string },
    billing: CustomerContext,
  ) =>
    (
      await import("@/server/features/ai-fact-checks/services/aiFactChecks")
    ).checkRunFacts(input, billing),
  factCheckReport: async (input: { projectId: string; runId?: string }) =>
    (
      await import("@/server/features/ai-fact-checks/services/aiFactChecks")
    ).factCheckReport(input),
  exportData: exportAiData,
};
