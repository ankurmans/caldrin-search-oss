/* eslint-disable max-lines -- all Site Explorer MCP tools are intentionally kept in one module */
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { DomainService } from "@/server/features/domain/services/DomainService";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { CompetitorExplorerService } from "@/server/features/site-explorer/services/CompetitorExplorerService";
import {
  KeywordGapExplorerService,
  type ExplorerContext,
} from "@/server/features/site-explorer/services/KeywordGapExplorerService";
import type { CustomerContext } from "@/server/lib/customer-context";
import { AppError } from "@/server/lib/errors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import {
  languageCodeSchema,
  locationCodeSchema,
  projectIdSchema,
} from "@/server/mcp/schemas";
import { formatMcpTable } from "@/server/mcp/table";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import {
  GAP_DEPTHS,
  GAP_INTENTS,
  GAP_KINDS,
  GAP_SORT_FIELDS,
  GAP_STATUSES,
  MAX_GAP_COMPETITORS,
  keywordGapQuerySchema,
} from "@/types/schemas/keyword-gap";

// Competitive research on a domain, shared with the Site Explorer and Keyword
// Gap pages. Reads of stored data cost nothing. Anything that calls the paid
// provider needs a cost ceiling the person approved after seeing the estimate;
// without one the tool returns the estimate and spends nothing.

const readOnly = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;
const paid = {
  readOnlyHint: false,
  openWorldHint: true,
  destructiveHint: false,
} as const;
const looseRows = z.array(z.looseObject({}));

function explorerContext(
  context: { billing: CustomerContext },
  projectId: string,
): ExplorerContext {
  return { ...context.billing, projectId, actor: "mcp" };
}

function requireManage(role: string) {
  if (!hasOrgPermission(role, { integration: ["manage"] })) {
    throw new AppError(
      "FORBIDDEN",
      "Your organization role does not allow this action.",
    );
  }
}

// A refusal explains itself; anything else is a real fault.
function refusal(text: string) {
  return mcpResponse({
    text,
    structuredContent: { refused: true, reason: text },
  });
}
function isRefusal(error: unknown): error is Error {
  return (
    error instanceof OpportunityRefusal || error instanceof SpendLimitRefusal
  );
}

export const getTopPagesTool = {
  name: "get_top_pages",
  config: {
    title: "Get a domain's top pages",
    description:
      "List the pages that earn a domain the most organic search traffic in one market, each with estimated monthly visits and the number of keywords it ranks for. Third-party estimates from DataForSEO, not first-party data; for this site's own traffic use get_search_console_performance. Uses credits; repeat reads of the same page are cached for 12 hours.",
    inputSchema: {
      projectId: projectIdSchema,
      target: z.string().min(1).max(2048).describe("Domain, subdomain or URL."),
      locationCode: locationCodeSchema.optional(),
      languageCode: languageCodeSchema.optional(),
      sortBy: z.enum(["traffic", "keywords"]).default("traffic"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(10).max(100).default(25),
    },
    outputSchema: z.looseObject({
      pages: looseRows,
      totalCount: z.number().nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: paid,
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        target: string;
        locationCode?: number;
        languageCode?: string;
        sortBy: "traffic" | "keywords";
        page: number;
        pageSize: number;
      },
      context,
    ) => {
      const result = await DomainService.getPagesPage(
        {
          projectId: args.projectId,
          domain: args.target,
          locationCode: args.locationCode ?? context.project.locationCode,
          languageCode: args.languageCode ?? context.project.languageCode,
          page: args.page,
          pageSize: args.pageSize,
          sortMode: args.sortBy,
          sortOrder: "desc",
          filters: {},
        },
        context.billing,
      );
      return mcpResponse({
        text: `${result.pages.length} top pages for ${result.domain} (of ${result.totalCount ?? "an unknown number"}), read ${result.fetchedAt}.\n${formatMcpTable(
          result.pages,
          [
            { header: "page", value: (row) => row.page },
            { header: "est. visits", value: (row) => row.organicTraffic },
            { header: "keywords", value: (row) => row.keywords },
          ],
        )}`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/domain`,
          { domain: result.domain },
        ),
        structuredContent: {
          pages: result.pages,
          totalCount: result.totalCount,
        },
      });
    },
  ),
};

export const listSavedCompetitorsTool = {
  name: "list_saved_competitors",
  config: {
    title: "List saved competitors",
    description:
      "List the competitors saved for a project, each with the markets it is compared in and the date a keyword gap last read it. These are the competitors every research tool reuses. Uses no credits.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: z.looseObject({
      competitors: looseRows,
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const competitors = await CompetitorExplorerService.list(args.projectId);
    return mcpResponse({
      text: competitors.length
        ? `${competitors.length} saved competitors.\n${formatMcpTable(
            competitors,
            [
              { header: "domain", value: (row) => row.domain },
              { header: "source", value: (row) => row.source },
              { header: "last gap read", value: (row) => row.lastAnalysedAt },
              { header: "markets", value: (row) => row.markets.length },
            ],
          )}`
        : "No competitors are saved. Use get_organic_competitors to find some.",
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/competitors`,
      ),
      structuredContent: { competitors },
    });
  }),
};

export const getOrganicCompetitorsTool = {
  name: "get_organic_competitors",
  config: {
    title: "Find organic competitors",
    description:
      "Find the domains that rank for the same keywords as the project's own domain, with how many keywords they share and their estimated organic traffic. Without maxCostUsd this returns the last discovery kept for the project (if any) and the cost of a fresh one, and spends nothing. To run a fresh paid read, pass maxCostUsd (the estimate the user approved); a higher fresh estimate is refused. Third-party estimates, not a complete keyword universe.",
    inputSchema: {
      projectId: projectIdSchema,
      locationCode: locationCodeSchema.optional(),
      languageCode: languageCodeSchema.optional(),
      maxCostUsd: z
        .number()
        .positive()
        .optional()
        .describe(
          "Spending ceiling the user approved. Omit to only preview the cost.",
        ),
    },
    outputSchema: z.looseObject({
      competitors: looseRows,
      estimatedUsd: z.number().nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: paid,
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        locationCode?: number;
        languageCode?: string;
        maxCostUsd?: number;
      },
      context,
    ) => {
      const ctx = explorerContext(context, args.projectId);
      const market = {
        locationCode: args.locationCode,
        languageCode: args.languageCode,
      };
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/competitors`,
      );
      const [cached, quote] = await Promise.all([
        CompetitorExplorerService.cachedDiscovery(ctx, market),
        CompetitorExplorerService.estimateDiscovery(ctx, market),
      ]);
      if (args.maxCostUsd === undefined) {
        return mcpResponse({
          text: cached
            ? `Last discovery (${cached.observedAt}): ${cached.items.length} competitors. A fresh read is estimated at $${quote.estimatedUsd?.toFixed(2) ?? "unknown"}; pass maxCostUsd to run it.`
            : `No discovery is kept yet. A read is estimated at $${quote.estimatedUsd?.toFixed(2) ?? "unknown"}${quote.reason ? ` (${quote.reason})` : ""}; pass maxCostUsd to run it.`,
          meta,
          structuredContent: {
            competitors: cached?.items ?? [],
            observedAt: cached?.observedAt ?? null,
            estimatedUsd: quote.estimatedUsd,
          },
        });
      }
      requireManage(context.auth.role);
      if (quote.estimatedUsd !== null && quote.estimatedUsd > args.maxCostUsd) {
        return refusal(
          `The fresh estimate $${quote.estimatedUsd.toFixed(2)} is above maxCostUsd $${args.maxCostUsd.toFixed(2)}. Nothing was fetched.`,
        );
      }
      try {
        const found = await CompetitorExplorerService.discover(ctx, market);
        return mcpResponse({
          text: `${found.items.length} organic competitors for ${found.target} (read ${found.observedAt}, $${found.costUsd.toFixed(2)}).\n${formatMcpTable(
            found.items,
            [
              { header: "domain", value: (row) => row.domain },
              { header: "shared keywords", value: (row) => row.sharedKeywords },
              { header: "avg position", value: (row) => row.avgPosition },
              { header: "est. visits", value: (row) => row.organicTraffic },
            ],
          )}`,
          meta,
          structuredContent: {
            competitors: found.items,
            observedAt: found.observedAt,
            estimatedUsd: found.costUsd,
          },
        });
      } catch (error) {
        if (isRefusal(error)) return refusal(error.message);
        throw error;
      }
    },
  ),
};

const gapFilterShape = {
  runId: z.string().optional().describe("A run from list; latest by default."),
  search: z.string().max(100).optional(),
  kind: z.enum(GAP_KINDS).optional(),
  status: z.enum(GAP_STATUSES).optional(),
  intent: z.enum(GAP_INTENTS).optional(),
  competitor: z.string().optional(),
  minVolume: z.number().int().min(0).optional(),
  maxVolume: z.number().int().min(0).optional(),
  minKd: z.number().int().min(0).max(100).optional(),
  maxKd: z.number().int().min(0).max(100).optional(),
  minPosition: z.number().int().min(1).max(100).optional(),
  maxPosition: z.number().int().min(1).max(100).optional(),
  minCompetitors: z.number().int().min(1).max(MAX_GAP_COMPETITORS).optional(),
} as const;

export const getKeywordGapTool = {
  name: "get_keyword_gap",
  config: {
    title: "Get the keyword gap",
    description:
      "Read the project's stored keyword gap: keywords competitors rank for that the project's domain does not (kind missing) and, if the run included them, shared keywords where a competitor ranks higher (kind outranked). Each row has volume, difficulty, the best competitor and URL, every compared competitor's position, a likely page type guessed from the URL, and the date the provider data was observed. Filter, sort and page. Also returns how many keywords were read per competitor against the provider's own count: it is a sample, never a complete keyword universe. Uses no credits; run_keyword_gap creates a fresh read.",
    inputSchema: {
      projectId: projectIdSchema,
      ...gapFilterShape,
      sortBy: z.enum(GAP_SORT_FIELDS).default("searchVolume"),
      sortDir: z.enum(["asc", "desc"]).default("desc"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(10).max(100).default(25),
    },
    outputSchema: z.looseObject({
      rows: looseRows,
      total: z.number(),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string } & Record<string, unknown>, context) => {
      const { projectId, ...rest } = args;
      const query = keywordGapQuerySchema.parse(rest);
      const meta = buildProjectMeta(
        context,
        projectId,
        `/p/${projectId}/keyword-gap`,
      );
      const result = await KeywordGapExplorerService.list(projectId, query);
      if (!result) {
        return mcpResponse({
          text: "No keyword gap has been read for this project yet. Call run_keyword_gap to preview the cost.",
          meta,
          structuredContent: { rows: [], total: 0 },
        });
      }
      const coverage = result.competitors
        .map(
          (c) =>
            `${c.competitorDomain} (${c.kind}): ${c.status === "ok" ? `${c.rowsRead} read${c.providerTotal === null ? "" : ` of ${c.providerTotal} the provider counted`}` : `failed: ${c.error ?? "unknown"}`}`,
        )
        .join("; ");
      return mcpResponse({
        text: `${result.total} keywords match (run ${result.run.id}, read ${result.run.createdAt} in market ${result.run.locationCode}/${result.run.languageCode}). Coverage: ${coverage}. This is a sample of the provider's data, not every keyword.\n${formatMcpTable(
          result.rows,
          [
            { header: "keyword", value: (row) => row.keyword },
            { header: "kind", value: (row) => row.kind },
            { header: "volume", value: (row) => row.searchVolume },
            { header: "KD", value: (row) => row.keywordDifficulty },
            {
              header: "best",
              value: (row) => `${row.bestDomain} #${row.bestPosition}`,
            },
            { header: "competitors", value: (row) => row.competitorCount },
            { header: "page type", value: (row) => row.likelyPageType },
            { header: "status", value: (row) => row.status },
          ],
        )}`,
        meta,
        structuredContent: {
          run: result.run,
          coverage: result.competitors,
          total: result.total,
          rows: result.rows,
        },
      });
    },
  ),
};

export const runKeywordGapTool = {
  name: "run_keyword_gap",
  config: {
    title: "Run a keyword gap",
    description: `Compare the project's domain with up to ${MAX_GAP_COMPETITORS} competitors (saved ones by default) and store the keywords they rank for that the project does not. Without maxCostUsd this only returns the cost estimate and spends nothing. To run it, pass maxCostUsd (the estimate the user approved); the run is refused if the fresh estimate is higher, if it would pass the project's spend limits, or if a gap already ran today and confirmRepeat is not set. The provider returns the most-searched keywords first, so the result is a sample. Read it with get_keyword_gap.`,
    inputSchema: {
      projectId: projectIdSchema,
      competitors: z
        .array(z.string().min(1).max(253))
        .max(10)
        .optional()
        .describe(
          `Domains to compare, at most ${MAX_GAP_COMPETITORS}. Defaults to the saved competitors.`,
        ),
      locationCode: locationCodeSchema.optional(),
      languageCode: languageCodeSchema.optional(),
      keywordsPerCompetitor: z
        .number()
        .int()
        .refine((n) => GAP_DEPTHS.some((depth) => depth === n))
        .default(100)
        .describe(`One of ${GAP_DEPTHS.join(", ")}.`),
      includeOutranked: z
        .boolean()
        .default(false)
        .describe(
          "Also read shared keywords where a competitor ranks higher. Doubles the cost.",
        ),
      maxCostUsd: z.number().positive().optional(),
      confirmRepeat: z.boolean().optional(),
    },
    outputSchema: z.looseObject({
      estimatedUsd: z.number().nullable(),
      ran: z.boolean(),
      ...optionalMetaOutputSchema,
    }),
    annotations: paid,
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        competitors?: string[];
        locationCode?: number;
        languageCode?: string;
        keywordsPerCompetitor: number;
        includeOutranked: boolean;
        maxCostUsd?: number;
        confirmRepeat?: boolean;
      },
      context,
    ) => {
      const ctx = explorerContext(context, args.projectId);
      const input = {
        competitors: args.competitors ?? [],
        locationCode: args.locationCode,
        languageCode: args.languageCode,
        rowsPerCompetitor: args.keywordsPerCompetitor,
        includeOutranked: args.includeOutranked,
      };
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/keyword-gap`,
      );
      const quote = await KeywordGapExplorerService.estimate(ctx, input);
      if (!quote.available || quote.estimatedUsd === null) {
        return mcpResponse({
          text: `${quote.reason ?? "The keyword gap cannot run."} Nothing was fetched.`,
          meta,
          structuredContent: { ran: false, estimatedUsd: quote.estimatedUsd },
        });
      }
      if (args.maxCostUsd === undefined) {
        return mcpResponse({
          text: `Estimated $${quote.estimatedUsd.toFixed(2)} for ${quote.providerReads} provider reads (${quote.competitors.join(", ")}). ${quote.ranToday ? `A gap already ran today for $${quote.ranToday.costUsd.toFixed(2)}; set confirmRepeat to run another. ` : ""}Nothing was fetched. Pass maxCostUsd to run it.`,
          meta,
          structuredContent: { ran: false, estimatedUsd: quote.estimatedUsd },
        });
      }
      requireManage(context.auth.role);
      if (quote.estimatedUsd > args.maxCostUsd) {
        return refusal(
          `The fresh estimate $${quote.estimatedUsd.toFixed(2)} is above maxCostUsd $${args.maxCostUsd.toFixed(2)}. Nothing was fetched.`,
        );
      }
      try {
        const result = await KeywordGapExplorerService.run(ctx, input, {
          repeat: args.confirmRepeat === true,
        });
        return mcpResponse({
          text: `Stored ${result.rowCount} keywords${result.partial ? " (some reads failed: see coverage in get_keyword_gap)" : ""}. Charged about $${result.costUsd.toFixed(2)}. Read them with get_keyword_gap.`,
          meta,
          structuredContent: {
            ran: true,
            runId: result.runId,
            rowCount: result.rowCount,
            costUsd: result.costUsd,
            estimatedUsd: quote.estimatedUsd,
          },
        });
      } catch (error) {
        if (isRefusal(error)) return refusal(error.message);
        throw error;
      }
    },
  ),
};

export const createOpportunityFromKeywordGapTool = {
  name: "create_opportunity_from_keyword_gap",
  config: {
    title: "Create an opportunity from a keyword gap",
    description:
      "Store a Search Opportunity for one keyword from a keyword gap run, with the competitor evidence and observation date. The recommended action follows the keyword's intent and the page type that wins it: product, collection and service keywords never get a blog recommendation, and a keyword naming the brand is refused. Calling it again for the same keyword updates the same opportunity. Find rows with get_keyword_gap. Uses no credits.",
    inputSchema: {
      projectId: projectIdSchema,
      runId: z.string().min(1),
      keyword: z.string().min(1).max(200),
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
      args: { projectId: string; runId: string; keyword: string },
      context,
    ) => {
      requireManage(context.auth.role);
      const ctx = explorerContext(context, args.projectId);
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/opportunities`,
      );
      const found = await KeywordGapExplorerService.list(args.projectId, {
        ...keywordGapQuerySchema.parse({
          runId: args.runId,
          search: args.keyword,
          status: "all",
        }),
      });
      const row = found?.rows.find(
        (r) => r.keyword === args.keyword.trim().toLowerCase(),
      );
      if (!row) {
        return refusal(
          `"${args.keyword}" is not in run ${args.runId} for this project.`,
        );
      }
      try {
        const created = await KeywordGapExplorerService.createOpportunity(ctx, {
          runId: args.runId,
          rowId: row.id,
        });
        return mcpResponse({
          text: `Opportunity ${created.opportunityId} stored for "${created.keyword}" with recommended action ${created.action}. It is open in Opportunities; nothing was published.`,
          meta,
          structuredContent: { created: true, ...created },
        });
      } catch (error) {
        if (isRefusal(error)) return refusal(error.message);
        throw error;
      }
    },
  ),
};
