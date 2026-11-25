import { hostedOrigin } from "@/shared/hosted-origin";
/* eslint-disable max-lines -- one registration list for every MCP tool module */
import { audited } from "@/server/mcp/audited";
import { runInWorkspace } from "@/server/lib/workspace-scope";
import { enforceMcpUsage } from "@/server/mcp/usage-limit";
import {
  getAiVisibilityTrackerTool,
  generateAiVisibilityPromptsTool,
  researchAiVisibilityPromptsTool,
  completeAiResearchSetupTool,
  saveAiVisibilityTrackerTool,
  estimateAiVisibilityCostTool,
  setAiVisibilityScheduleTool,
  setAiVisibilityMarketsTool,
  runAiVisibilityCheckTool,
  getAiVisibilityRunTool,
  getAiVisibilityResultsTool,
  getAiVisibilityAnswerTool,
  getAiVisibilitySourcesTool,
  getAiVisibilityTrendTool,
  exportAiVisibilityDataTool,
} from "@/server/mcp/tools/ai-visibility-tools";
import {
  classifyAiVisibilitySentimentTool,
  lookupAiPromptVolumeTool,
  getTopCitedDomainsTool,
  getAiCrawlerActivityTool,
  compareAiVisibilityWindowsTool,
  checkAiCrawlerAccessTool,
} from "@/server/mcp/tools/ai-visibility-insight-tools";
import { getLocalOverviewTool } from "@/server/mcp/tools/local-overview-tool";
import {
  getAiPerceptionTool,
  reviewAiPerceptionTool,
} from "@/server/mcp/tools/ai-perception-tools";
import {
  getAiPerceptionExperimentTool,
  getAiPerceptionOpportunitiesTool,
  getAiPerceptionOverviewTool,
  getAiPerceptionSourcesTool,
  listAiPerceptionExperimentsTool,
  loadAiPerceptionExperimentPageTool,
  queueAiPerceptionExperimentOpportunityTool,
  replayAiPerceptionExperimentTool,
  saveAiPerceptionExperimentTool,
  saveAiPerceptionOpportunityTool,
} from "@/server/mcp/tools/ai-perception-experiment-tools";
import {
  listBrandFactsTool,
  addBrandFactTool,
  removeBrandFactTool,
  checkBrandFactsTool,
  getFactCheckReportTool,
} from "@/server/mcp/tools/ai-visibility-fact-tools";
import {
  getAiVisibilityInsightsTool,
  getCitationGapsTool,
  getAiObservedProductsTool,
  getRankedActionsTool,
  getAiVisibilityReportTool,
} from "@/server/mcp/tools/ai-visibility-report-tools";
import {
  type CallToolResult,
  McpServer,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  createMcpToolContext,
  type McpProps,
  type ToolContext,
} from "@/server/mcp/context";
import { objectSchema } from "@/server/mcp/output-schemas";
import { memoizeJsonSchema } from "@/server/mcp/json-schema-memo";
import {
  instrumentMcpToolHandler,
  instrumentMcpToolInput,
} from "@/server/mcp/instrumentation";
import { submitIndexNowUrlsTool } from "@/server/mcp/tools/submit-indexnow-urls";
import { syncAiCrawlerVisitsTool } from "@/server/mcp/tools/sync-ai-crawler-visits";
import { getBacklinksOverviewTool } from "@/server/mcp/tools/get-backlinks-overview";
import {
  checkLinkMentionsTool,
  createLinkOpportunityTool,
  draftLinkOutreachTool,
  findLinkGapsTool,
  findRecoverableLinksTool,
  getLinkGapTool,
  getLinkProspectTool,
  listAcquiredLinksTool,
  listLinkCampaignActivityTool,
  listLinkProspectsTool,
  qualifyLinkProspectsTool,
  saveLinkProspectsTool,
  verifyLinkPageTool,
} from "@/server/mcp/tools/link-acquisition-tools";
import { getBacklinksProfileTool } from "@/server/mcp/tools/get-backlinks-profile";
import { getDomainKeywordSuggestionsTool } from "@/server/mcp/tools/get-domain-keyword-suggestions";
import { getDomainOverviewTool } from "@/server/mcp/tools/get-domain-overview";
import { addRankTrackingKeywordsTool } from "@/server/mcp/tools/add-rank-tracking-keywords";
import { createRankTrackerTool } from "@/server/mcp/tools/create-rank-tracker";
import { estimateRankTrackerCostTool } from "@/server/mcp/tools/estimate-rank-tracker-cost";
import { getRankHistoryTool } from "@/server/mcp/tools/get-rank-history";
import { getRankTrackerTool } from "@/server/mcp/tools/get-rank-tracker";
import { removeRankTrackingKeywordsTool } from "@/server/mcp/tools/remove-rank-tracking-keywords";
import { pinRankTrackingKeywordsTool } from "@/server/mcp/tools/pin-rank-tracking-keywords";
import { runRankTrackerTool } from "@/server/mcp/tools/run-rank-tracker";
import { searchSerpLocationsTool } from "@/server/mcp/tools/search-serp-locations";
import { getSerpResultsTool } from "@/server/mcp/tools/get-serp-results";
import {
  getGoogleAnalyticsAudienceBreakdownTool,
  getGoogleAnalyticsEcommercePerformanceTool,
  getGoogleAnalyticsKeyEventsTool,
  getGoogleAnalyticsMeasurementHealthTool,
  getGoogleAnalyticsOrganicLandingPagesTool,
  getGoogleAnalyticsOrganicOverviewTool,
  getGoogleAnalyticsPagePerformanceTool,
  getGoogleAnalyticsSiteSearchTool,
  getGoogleAnalyticsTrafficAcquisitionTool,
  getSearchOpportunitiesTool,
} from "@/server/mcp/tools/google-analytics-tools";
import { createProjectTool } from "@/server/mcp/tools/create-project";
import {
  listGoogleAnalyticsPropertiesTool,
  listSearchConsoleSitesTool,
  setGoogleAnalyticsPropertyTool,
  setSearchConsoleSiteTool,
} from "@/server/mcp/tools/google-connection-tools";
import { listProjectsTool } from "@/server/mcp/tools/list-projects";
import {
  researchProjectWebsiteTool,
  saveProjectWebsiteSetupTool,
} from "@/server/mcp/tools/project-website";
import {
  getProjectContextTool,
  updateProjectContextTool,
} from "@/server/mcp/tools/project-context";
import {
  createOpportunityFromKeywordGapTool,
  getKeywordGapTool,
  getOrganicCompetitorsTool,
  getTopPagesTool,
  listSavedCompetitorsTool,
  runKeywordGapTool,
} from "@/server/mcp/tools/site-explorer-tools";
import {
  analyseSourcePageTool,
  createSourceOpportunityTool,
  createGapOpportunityTool,
  getSourceIntelligenceTool,
} from "@/server/mcp/tools/source-intelligence-tools";
import {
  compareAttributionModelsTool,
  getAttributionEvidenceTool,
  getAttributionHealthTool,
  getAttributionLandingPagesTool,
  getAttributionLeadsTool,
  getAttributionOverviewTool,
} from "@/server/mcp/tools/attribution-tools";
import {
  getSearchCommandCentreTool,
  getSpendAndLimitsTool,
  listChangesAndApprovalsTool,
  listMonitoringAlertsTool,
} from "@/server/mcp/tools/command-centre-tools";
import {
  createContentDraftTool,
  getContentPerformanceTool,
  getContentQualityChecksTool,
  listContentDraftsTool,
  listContentOpportunitiesTool,
} from "@/server/mcp/tools/content-tools";
import { listSavedKeywordsTool } from "@/server/mcp/tools/list-saved-keywords";
import { removeSavedKeywordsTool } from "@/server/mcp/tools/remove-saved-keywords";
import {
  findSerpCompetitorsTool,
  getGoogleBusinessQuestionsTool,
  getKeywordMetricsTool,
  getLocalSerpResultsTool,
  getRankedKeywordsTool,
  searchLocalBusinessesTool,
} from "@/server/mcp/tools/dataforseo-research-tools";
import {
  getBusinessProfileTool,
  getBusinessReviewsTool,
  getBusinessUpdatesTool,
  getLocalRankGridTool,
  listBusinessCategoriesTool,
} from "@/server/mcp/tools/local-seo-tools";
import {
  deleteReportTool,
  getReportTool,
  listReportsTool,
  saveReportTool,
} from "@/server/mcp/tools/report-tools";
import { setReportSharingTool } from "@/server/mcp/tools/report-sharing-tools";
import {
  deleteReportTemplateTool,
  listReportTemplatesTool,
  saveReportTemplateTool,
} from "@/server/mcp/tools/report-template-tools";
import { getSuggestedKeywordsTool } from "@/server/mcp/tools/get-suggested-keywords";
import { researchKeywordsTool } from "@/server/mcp/tools/research-keywords";
import { saveKeywordsTool } from "@/server/mcp/tools/save-keywords";
import {
  getSearchConsolePerformanceTool,
  inspectUrlsTool,
} from "@/server/mcp/tools/search-console-tools";
import {
  getAuditIssuesTool,
  getAuditLighthouseTool,
  getAuditPagesTool,
  getAuditStatusTool,
  runSiteAuditTool,
} from "@/server/mcp/tools/site-audit-tools";
import {
  deleteSiteAuditTool,
  listSiteAuditsTool,
} from "@/server/mcp/tools/site-audit-cleanup-tools";
import { whoamiTool } from "@/server/mcp/tools/whoami";
import { explorePromptTool } from "@/server/mcp/tools/explore-prompt";
import { registerWidgetResource } from "@/server/mcp/widget-resource";
import { rememberWidgetResult } from "@/server/mcp/widget-results";
import { WidgetTool } from "@/shared/mcp-contracts";
import {
  showSearchConsolePerformanceTool,
  showSerpResultsTool,
} from "@/server/mcp/tools/widget-tools";

type ToolSchema = z.ZodType | z.ZodRawShape;

// Tools declare inputSchema as either a raw Zod shape (most tools) or a full
// z.object (the GA4 tools); both normalize to one object schema at
// registration.
type ToolArgs<Input extends ToolSchema> = Input extends z.ZodType
  ? z.infer<Input>
  : Input extends z.ZodRawShape
    ? z.infer<z.ZodObject<Input>>
    : never;

type CaldrinSearchToolDefinition<Input extends ToolSchema> = {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema: Input;
    outputSchema?: ToolSchema;
    annotations?: ToolAnnotations;
    _meta?: Record<string, unknown>;
  };
  handler: (
    args: ToolArgs<Input>,
    context: ToolContext,
  ) => CallToolResult | Promise<CallToolResult>;
};

const widgetToolName = z.enum(WidgetTool);

type ToolSchemas = {
  // Handed to the SDK, which converts them to JSON Schema for tools/list.
  inputSchema: StandardSchemaWithJSON;
  outputSchema: StandardSchemaWithJSON | undefined;
  // The same output schema as zod, for the handler instrumentation.
  outputZod: z.ZodType | undefined;
};

// Built once per isolate and shared by every per-request server (see
// transport.ts) so the SDK's JSON Schema conversion is paid once per tool, not
// once per request. The widget-source tools get a second entry for clients
// without MCP Apps support, which see an output schema without resultId.
const toolSchemaCache = new Map<string, ToolSchemas>();

function toolSchemas(
  tool: {
    name: string;
    config: { inputSchema: ToolSchema; outputSchema?: ToolSchema };
  },
  omitResultId: boolean,
): ToolSchemas {
  const key = omitResultId ? `${tool.name}/no-result-id` : tool.name;
  let schemas = toolSchemaCache.get(key);
  if (!schemas) {
    // Output objects must allow added fields, including nested objects. The
    // tools/list contract test checks every registered tool for cached-client
    // compatibility; input schemas keep their existing validation rules.
    const schema = objectSchema(tool.config.outputSchema);
    const outputZod =
      omitResultId && schema instanceof z.ZodObject
        ? schema.omit({ resultId: true })
        : schema;
    schemas = {
      inputSchema: memoizeJsonSchema(objectSchema(tool.config.inputSchema)),
      outputSchema: outputZod && memoizeJsonSchema(outputZod),
      outputZod,
    };
    toolSchemaCache.set(key, schemas);
  }
  return schemas;
}

function registerCaldrinSearchTool<Input extends ToolSchema>(
  server: McpServer,
  tool: CaldrinSearchToolDefinition<Input>,
  authProps: McpProps,
  supportsApps: boolean,
) {
  const widgetSource = widgetToolName.safeParse(tool.name);
  const schemas = toolSchemas(tool, !supportsApps && widgetSource.success);
  const handler = instrumentMcpToolHandler(
    tool.name,
    schemas.outputZod,
    tool.handler,
  );
  server.registerTool(
    tool.name,
    {
      ...tool.config,
      // Wrapped per request, outside the isolate-wide cache: a rejection is
      // reported against this request's caller.
      inputSchema: instrumentMcpToolInput(
        tool.name,
        schemas.inputSchema,
        authProps,
      ),
      outputSchema: schemas.outputSchema,
    },
    async (args, context) => {
      const toolContext = createMcpToolContext(context, authProps);
      await enforceMcpUsage(toolContext.auth.organizationId);
      const result = await runInWorkspace(toolContext.auth.organizationId, () =>
        audited(tool, args, toolContext.auth, () =>
          handler(
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- args were validated against the tool's own inputSchema just above
            args as ToolArgs<Input>,
            toolContext,
          ),
        ),
      );
      if (!supportsApps || !widgetSource.success) return result;
      return rememberWidgetResult(
        widgetSource.data,
        args,
        result,
        toolContext.auth,
      );
    },
  );
}

// A tool renamed after release stays callable under its old name, so agents
// and saved prompts that use it keep working. Remove the alias once clients
// have moved over.
function renamedTool<Input extends ToolSchema>(
  tool: CaldrinSearchToolDefinition<Input>,
  oldName: string,
): CaldrinSearchToolDefinition<Input> {
  return {
    ...tool,
    name: oldName,
    config: {
      ...tool.config,
      description:
        `Old name of ${tool.name}; use that tool instead. ${tool.config.description ?? ""}`.trim(),
    },
  };
}

/** Every Caldrin Search tool, in order. */
export function registerCaldrinSearchTools(
  register: <Input extends ToolSchema>(
    tool: CaldrinSearchToolDefinition<Input>,
  ) => void,
) {
  register(whoamiTool);
  register(listProjectsTool);
  register(createProjectTool);
  register(researchProjectWebsiteTool);
  register(saveProjectWebsiteSetupTool);
  register(getProjectContextTool);
  register(updateProjectContextTool);
  register(listSavedKeywordsTool);
  register(listContentOpportunitiesTool);
  register(listContentDraftsTool);
  register(getContentQualityChecksTool);
  register(getContentPerformanceTool);
  register(createContentDraftTool);
  register(getSearchCommandCentreTool);
  register(
    renamedTool(getSearchCommandCentreTool, "get_search_command_centre"),
  );
  register(getTopPagesTool);
  register(getOrganicCompetitorsTool);
  register(listSavedCompetitorsTool);
  register(getKeywordGapTool);
  register(runKeywordGapTool);
  register(createOpportunityFromKeywordGapTool);
  register(getAttributionOverviewTool);
  register(compareAttributionModelsTool);
  register(getAttributionLeadsTool);
  register(getAttributionLandingPagesTool);
  register(getAttributionEvidenceTool);
  register(getAttributionHealthTool);
  register(getSourceIntelligenceTool);
  register(createSourceOpportunityTool);
  register(createGapOpportunityTool);
  register(analyseSourcePageTool);
  register(renamedTool(analyseSourcePageTool, "analyse_source_page"));
  register(listChangesAndApprovalsTool);
  register(getSpendAndLimitsTool);
  register(listMonitoringAlertsTool);
  register(removeSavedKeywordsTool);
  register(getSuggestedKeywordsTool);
  register(researchKeywordsTool);
  register(saveKeywordsTool);
  register(getDomainOverviewTool);
  register(getDomainKeywordSuggestionsTool);
  register(getBacklinksOverviewTool);
  register(getBacklinksProfileTool);
  register(findLinkGapsTool);
  register(findRecoverableLinksTool);
  register(checkLinkMentionsTool);
  register(getLinkGapTool);
  register(saveLinkProspectsTool);
  register(listLinkProspectsTool);
  register(getLinkProspectTool);
  register(qualifyLinkProspectsTool);
  register(createLinkOpportunityTool);
  register(draftLinkOutreachTool);
  register(listLinkCampaignActivityTool);
  register(verifyLinkPageTool);
  register(listAcquiredLinksTool);
  register(getSerpResultsTool);
  register(searchSerpLocationsTool);
  register(getAiVisibilityTrackerTool);
  register(explorePromptTool);
  register(generateAiVisibilityPromptsTool);
  register(researchAiVisibilityPromptsTool);
  register(completeAiResearchSetupTool);
  register(saveAiVisibilityTrackerTool);
  register(estimateAiVisibilityCostTool);
  register(setAiVisibilityScheduleTool);
  register(setAiVisibilityMarketsTool);
  register(runAiVisibilityCheckTool);
  register(classifyAiVisibilitySentimentTool);
  register(getAiPerceptionTool);
  register(reviewAiPerceptionTool);
  register(getAiPerceptionOverviewTool);
  register(getAiPerceptionSourcesTool);
  register(getAiPerceptionOpportunitiesTool);
  register(saveAiPerceptionOpportunityTool);
  register(listAiPerceptionExperimentsTool);
  register(getAiPerceptionExperimentTool);
  register(loadAiPerceptionExperimentPageTool);
  register(saveAiPerceptionExperimentTool);
  register(replayAiPerceptionExperimentTool);
  register(queueAiPerceptionExperimentOpportunityTool);
  register(listBrandFactsTool);
  register(addBrandFactTool);
  register(removeBrandFactTool);
  register(checkBrandFactsTool);
  register(getFactCheckReportTool);
  register(lookupAiPromptVolumeTool);
  register(getTopCitedDomainsTool);
  register(getAiCrawlerActivityTool);
  register(compareAiVisibilityWindowsTool);
  register(checkAiCrawlerAccessTool);
  register(getAiVisibilityRunTool);
  register(getAiVisibilityResultsTool);
  register(getAiVisibilityAnswerTool);
  register(getAiVisibilitySourcesTool);
  register(getAiVisibilityTrendTool);
  register(getAiVisibilityInsightsTool);
  register(getCitationGapsTool);
  register(getAiObservedProductsTool);
  register(getRankedActionsTool);
  register(getAiVisibilityReportTool);
  register(exportAiVisibilityDataTool);
  register(createRankTrackerTool);
  register(getRankTrackerTool);
  register(getRankHistoryTool);
  register(addRankTrackingKeywordsTool);
  register(removeRankTrackingKeywordsTool);
  register(pinRankTrackingKeywordsTool);
  register(estimateRankTrackerCostTool);
  register(runRankTrackerTool);
  register(getRankedKeywordsTool);
  register(findSerpCompetitorsTool);
  register(searchLocalBusinessesTool);
  register(getLocalSerpResultsTool);
  register(getGoogleBusinessQuestionsTool);
  register(getBusinessProfileTool);
  register(getBusinessReviewsTool);
  register(getBusinessUpdatesTool);
  register(listBusinessCategoriesTool);
  register(getLocalRankGridTool);
  register(getLocalOverviewTool);
  register(getKeywordMetricsTool);
  register(listSearchConsoleSitesTool);
  register(setSearchConsoleSiteTool);
  register(getSearchConsolePerformanceTool);
  register(inspectUrlsTool);
  register(submitIndexNowUrlsTool);
  register(syncAiCrawlerVisitsTool);
  register(listGoogleAnalyticsPropertiesTool);
  register(setGoogleAnalyticsPropertyTool);
  register(getGoogleAnalyticsOrganicLandingPagesTool);
  register(getGoogleAnalyticsPagePerformanceTool);
  register(getGoogleAnalyticsKeyEventsTool);
  register(getSearchOpportunitiesTool);
  register(getGoogleAnalyticsOrganicOverviewTool);
  register(getGoogleAnalyticsTrafficAcquisitionTool);
  register(getGoogleAnalyticsMeasurementHealthTool);
  register(getGoogleAnalyticsEcommercePerformanceTool);
  register(getGoogleAnalyticsSiteSearchTool);
  register(getGoogleAnalyticsAudienceBreakdownTool);
  register(runSiteAuditTool);
  register(listSiteAuditsTool);
  register(deleteSiteAuditTool);
  register(getAuditStatusTool);
  register(getAuditIssuesTool);
  register(getAuditPagesTool);
  register(getAuditLighthouseTool);
  register(saveReportTool);
  register(listReportsTool);
  register(getReportTool);
  register(setReportSharingTool);
  register(deleteReportTool);
  register(listReportTemplatesTool);
  register(saveReportTemplateTool);
  register(deleteReportTemplateTool);
}

export function createCaldrinSearchMcpServer(
  authProps: McpProps,
  supportsApps = false,
) {
  const server = new McpServer(
    {
      name: "Caldrin Search MCP",
      title: "Caldrin Search",
      version: "0.0.12",
      description:
        "SEO research tools for AI agents: keyword research and metrics, SERP and local SERP results, domain and backlink analysis, rank tracking, and Google Search Console performance.",
      ...(hostedOrigin && {
        websiteUrl: hostedOrigin,
        icons: [
          {
            src: `${hostedOrigin}/android-chrome-512x512.png`,
            mimeType: "image/png",
            sizes: ["512x512"],
          },
        ],
      }),
    },
    {
      // The tool list is fixed per request and no list_changed notification
      // is ever published, so don't advertise the capability — modern clients
      // use it to decide whether to open a subscriptions/listen stream.
      // Without the pre-declaration, registerTool defaults it to true.
      capabilities: { tools: { listChanged: false } },
      // Bounds schema validation work per tools/call (GHSA-46jr-4wx8-v453).
      // The largest real input is a 2,000-keyword list, far under this.
      maxToolInputElements: 20_000,
      // ChatGPT's directory review keeps serving the last approved
      // instructions until a change passes, and this is the approved text.
      // Edit it only alongside a planned review.
      instructions:
        "Caldrin Search research tools use credits. Proceed with normal focused research, but ask the user for confirmation before planned batches over 2,000 credits. Caldrin Search cannot purchase credits or charge cards. Explain unsupported purchase requests without promoting subscriptions, upgrades or credit purchases, or directing users to checkout.",
    },
  );

  const register = <Input extends ToolSchema>(
    tool: CaldrinSearchToolDefinition<Input>,
  ) => registerCaldrinSearchTool(server, tool, authProps, supportsApps);

  if (supportsApps) {
    registerWidgetResource(server);
    register(showSerpResultsTool);
    register(showSearchConsolePerformanceTool);
  }

  registerCaldrinSearchTools(register);

  return server;
}
