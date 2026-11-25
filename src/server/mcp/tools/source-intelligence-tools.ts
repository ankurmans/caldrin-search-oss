import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import {
  createSourceOpportunity,
  loadSourceIntelligence,
  SourceActionRefusal,
} from "@/server/features/source-intelligence/services/SourceIntelligenceService";
import { createGapOpportunity } from "@/server/features/citation-gaps/citationGapService";
import { citationGapSchema } from "@/types/schemas/citation-gaps";
import { analyseSourcePage } from "@/server/features/source-intelligence/services/SourcePageAnalysisService";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import { AppError } from "@/server/lib/errors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable } from "@/server/mcp/table";
import {
  APPROACH_LABELS,
  SOURCE_ACTIONS,
  SOURCE_VIEWS,
  sourceFiltersSchema,
  type SourceFilters,
} from "@/types/schemas/source-intelligence";
import { aiEngineSchema } from "@/types/schemas/ai-visibility";

// Searches, retrieved pages and cited pages behind tracked AI answers, from
// stored answers only. Nothing here calls a provider or spends credits.

function refusal(text: string) {
  return mcpResponse({
    text,
    structuredContent: { refused: true, reason: text },
  });
}

export const getSourceIntelligenceTool = {
  name: "get_source_intelligence",
  config: {
    title: "Get AI source intelligence",
    description:
      "The pages and searches behind tracked AI answers, from stored answers. view=sources lists pages with how many answers retrieved them and how many cited them; view=domains rolls them up by domain; view=queries lists the searches the provider reported the engine ran. A page marked retrieved_only was listed as retrieved but never cited; cited_only has no retrieval record. Retrieved pages and reported searches exist only where the provider exposes them (ChatGPT and Gemini scrapes, and search queries from Claude and Perplexity responses); coverage says per engine what was captured, and answers saved earlier are marked not captured, not empty. Nothing about hidden model searches is inferred. Filter by days (7, 28, 90, 365), engine, promptGroup (topic), brandDomain or sourceDomain. Uses no credits.",
    inputSchema: {
      projectId: projectIdSchema,
      view: z.enum(SOURCE_VIEWS).default("sources"),
      days: z
        .union([z.literal(7), z.literal(28), z.literal(90), z.literal(365)])
        .default(90),
      engine: aiEngineSchema.optional(),
      promptGroup: z.string().trim().min(1).max(100).optional(),
      brandDomain: z.string().trim().min(1).max(253).optional(),
      sourceDomain: z.string().trim().min(1).max(253).optional(),
      page: z.number().int().min(1).max(1000).default(1),
    },
    outputSchema: z.looseObject({
      total: z.number(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        view: (typeof SOURCE_VIEWS)[number];
        days: 7 | 28 | 90 | 365;
        engine?: SourceFilters["engine"];
        promptGroup?: string;
        brandDomain?: string;
        sourceDomain?: string;
        page: number;
      },
      context,
    ) => {
      const filters = sourceFiltersSchema.parse({
        days: args.days,
        engine: args.engine,
        promptGroup: args.promptGroup,
        brandDomain: args.brandDomain,
        sourceDomain: args.sourceDomain,
      });
      const result = await loadSourceIntelligence({
        projectId: args.projectId,
        filters,
        view: args.view,
        sortBy: args.view === "queries" ? "answers" : "cited",
        sortDir: "desc",
        page: args.page,
        pageSize: 50,
      });
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/ai-visibility/sources`,
      );
      const table =
        result.view === "queries"
          ? formatMcpTable(result.queryRows, [
              { header: "Search reported", value: (r) => r.query },
              { header: "Answers", value: (r) => r.answers },
              { header: "Engines", value: (r) => r.engines.join(", ") },
              { header: "Last seen", value: (r) => r.lastSeen },
            ])
          : formatMcpTable(result.rows, [
              { header: "Source", value: (r) => r.key },
              { header: "Relation", value: (r) => r.relation },
              { header: "Cited in", value: (r) => r.citedAnswers },
              { header: "Retrieved in", value: (r) => r.retrievedAnswers },
              { header: "Type", value: (r) => r.sourceClass },
              { header: "Brand", value: (r) => r.brand ?? "" },
              { header: "Last seen", value: (r) => r.lastSeen },
            ]);
      return mcpResponse({
        text: [
          `${result.total} ${result.view} across ${result.answers} answered collections in the last ${args.days} days.`,
          ...result.notes,
          table,
        ].join("\n"),
        meta,
        structuredContent: { ...result },
      });
    },
  ),
};

export const createSourceOpportunityTool = {
  name: "create_source_opportunity",
  config: {
    title: "Create an opportunity from an AI source",
    description:
      "Store a Search Opportunity from one source page seen in tracked AI answers, with the prompts, reported searches, retrieved and cited counts and collection dates as evidence. action=content recommends a page or article (never a blog post for a product, collection, service or pricing page), third_party recommends earning coverage on that page, link_prospect marks it as a link prospect. Calling it again for the same page and action updates the same opportunity. A listing on a page does not guarantee a future AI citation. Find pages with get_source_intelligence. Needs manage access. Uses no credits and publishes nothing.",
    inputSchema: {
      projectId: projectIdSchema,
      url: z.string().trim().min(1).max(16_384),
      action: z.enum(SOURCE_ACTIONS),
      days: z
        .union([z.literal(7), z.literal(28), z.literal(90), z.literal(365)])
        .default(90),
    },
    outputSchema: z.looseObject({
      created: z.boolean(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        url: string;
        action: (typeof SOURCE_ACTIONS)[number];
        days: 7 | 28 | 90 | 365;
      },
      context,
    ) => {
      if (!hasOrgPermission(context.auth.role, { integration: ["manage"] }))
        throw new AppError(
          "FORBIDDEN",
          "Your organization role does not allow this action.",
        );
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/opportunities`,
      );
      try {
        const created = await createSourceOpportunity(
          {
            projectId: args.projectId,
            organizationId: context.billing.organizationId,
          },
          {
            filters: sourceFiltersSchema.parse({ days: args.days }),
            url: args.url,
            action: args.action,
          },
        );
        return mcpResponse({
          text: `Opportunity ${created.opportunityId} stored for ${args.url}. It is open in Opportunities; nothing was published.`,
          meta,
          structuredContent: { created: true, ...created },
        });
      } catch (error) {
        if (
          error instanceof SourceActionRefusal ||
          error instanceof OpportunityRefusal
        )
          return refusal(error.message);
        throw error;
      }
    },
  ),
};

export const createGapOpportunityTool = {
  name: "create_gap_opportunity",
  config: {
    title: "Create an opportunity from a ranked action",
    description:
      "Store a Search Opportunity from one action returned by get_ranked_actions, using its findingKey and the same days, engines and topic filters. The finding is recomputed from stored answers, and the opportunity carries the prompts, competitors, cited sources and collection dates as evidence. Calling it again for the same finding updates the same opportunity. Measurement notes are not actions and are refused. Needs manage access. Uses no credits and publishes nothing.",
    inputSchema: {
      ...citationGapSchema.shape,
      projectId: projectIdSchema,
      findingKey: z.string().min(1).max(600),
    },
    outputSchema: z.looseObject({
      created: z.boolean(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: { projectId: string; findingKey: string } & z.infer<
        typeof citationGapSchema
      >,
      context,
    ) => {
      if (!hasOrgPermission(context.auth.role, { integration: ["manage"] }))
        throw new AppError(
          "FORBIDDEN",
          "Your organization role does not allow this action.",
        );
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/opportunities`,
      );
      try {
        const { opportunityId, finding } = await createGapOpportunity(
          {
            projectId: args.projectId,
            organizationId: context.billing.organizationId,
          },
          { ...args, findingKey: args.findingKey },
        );
        return mcpResponse({
          text: `Opportunity ${opportunityId} stored for "${finding.title}". It is open in Opportunities; nothing was published.`,
          meta,
          structuredContent: { created: true, opportunityId },
        });
      } catch (error) {
        if (error instanceof OpportunityRefusal) return refusal(error.message);
        throw error;
      }
    },
  ),
};

export const analyseSourcePageTool = {
  name: "analyze_source_page",
  config: {
    title: "Read and analyze an AI source page",
    description:
      "Read one external page that appeared in this project's tracked AI answers and describe it: what it covers, what kind of page it is, the buyer questions it answers, which tracked competitors and whether your brand it names (matched in the page text), and dated facts that may be out of date, plus a suggested approach (owned content gap, comparison opportunity or independent source opportunity). A suggestion to investigate: being named on a page does not guarantee a future AI citation. Only pages found with get_source_intelligence are read. This spends: without maxCostUsd it returns the price and reads nothing; pass the returned estimatedUsd as maxCostUsd to run it. A reading under 30 days old is returned free unless refresh is true. Needs manage access.",
    inputSchema: {
      projectId: projectIdSchema,
      url: z.string().trim().min(1).max(16_384),
      maxCostUsd: z.number().min(0).max(5).optional(),
      refresh: z.boolean().default(false),
    },
    outputSchema: z.looseObject({
      status: z.string(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        url: string;
        maxCostUsd?: number;
        refresh: boolean;
      },
      context,
    ) => {
      if (!hasOrgPermission(context.auth.role, { integration: ["manage"] }))
        throw new AppError(
          "FORBIDDEN",
          "Your organization role does not allow this action.",
        );
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/ai-visibility/sources`,
      );
      try {
        const priced = await analyseSourcePage(
          { ...context.billing, projectId: args.projectId },
          {
            projectId: args.projectId,
            organizationId: context.billing.organizationId,
            userId: context.auth.userId,
          },
          { url: args.url, confirm: false, refresh: args.refresh },
        );
        if (priced.status === "done") return describe(priced, meta);
        if (
          args.maxCostUsd === undefined ||
          args.maxCostUsd < priced.estimatedUsd
        )
          return mcpResponse({
            text: `Reading this page costs up to $${priced.estimatedUsd.toFixed(2)}. ${priced.basis} Call again with maxCostUsd of at least ${priced.estimatedUsd} to run it.`,
            meta,
            structuredContent: {
              status: "preview",
              estimatedUsd: priced.estimatedUsd,
            },
          });
        const result = await analyseSourcePage(
          { ...context.billing, projectId: args.projectId },
          {
            projectId: args.projectId,
            organizationId: context.billing.organizationId,
            userId: context.auth.userId,
          },
          { url: args.url, confirm: true, refresh: args.refresh },
        );
        return result.status === "done"
          ? describe(result, meta)
          : refusal("The page was not read.");
      } catch (error) {
        if (
          error instanceof SourceActionRefusal ||
          error instanceof SpendLimitRefusal
        )
          return refusal(error.message);
        throw error;
      }
    },
  ),
};

function describe(
  result: Extract<
    Awaited<ReturnType<typeof analyseSourcePage>>,
    { status: "done" }
  >,
  meta: ReturnType<typeof buildProjectMeta>,
) {
  const a = result.analysis;
  const items = (kind: string) =>
    a.items.filter((i) => i.kind === kind).map((i) => i.text);
  return mcpResponse({
    text: [
      `${a.title ?? a.url} (${a.pageKind}). ${a.summary}`,
      `Approach: ${APPROACH_LABELS[a.approach]}. Brand named: ${a.namesBrand ? "yes" : "no"}. Competitors named: ${items("competitor_named").join(", ") || "none"}.`,
      `Buyer questions answered: ${items("buyer_question").join("; ") || "none found"}.`,
      `Dated facts to check: ${items("dated_fact").join("; ") || "none found"}.`,
      "Being named on a page does not guarantee a future AI citation.",
    ].join("\n"),
    meta,
    structuredContent: { ...a, status: "done", readCostUsd: result.costUsd },
  });
}
