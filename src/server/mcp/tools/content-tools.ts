import { z } from "zod";
import { ContentRefusal } from "@/server/features/content/rules/contentRefusal";
import { getContentPerformance } from "@/server/features/content/services/contentPerformance";
import { ContentService } from "@/server/features/content/services/ContentService";
import { hasOrgPermission } from "@/lib/org-permissions";
import { AppError } from "@/server/lib/errors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

// Content tools read and draft only. Approving, creating Shopify articles and
// publishing stay in the app, behind a person's approval: no tool here (or
// anywhere in the MCP server) reaches them.

const projectInput = { projectId: projectIdSchema } as const;
const readOnly = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;

export const listContentOpportunitiesTool = {
  name: "list_content_opportunities",
  config: {
    title: "List content opportunities",
    description:
      "List search opportunities found for a project's Shopify content: queries with impressions and weak clicks, each with the Search Console numbers, the rule that fired and a recommended action. Run from the app's Content studio; uses no credits.",
    inputSchema: projectInput,
    outputSchema: z.looseObject({
      opportunities: z.array(z.looseObject({ id: z.string() })),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const rows = await ContentService.listOpportunities(args.projectId);
    const opportunities = rows.map((o) => ({
      id: o.id,
      query: o.query,
      pageUrl: o.pageUrl,
      impressions: o.impressions,
      clicks: o.clicks,
      ctr: o.ctr,
      position: o.position,
      recommendedAction: o.recommendedAction,
      reason: o.reason,
      status: o.status,
      dataSource: o.dataSource,
    }));
    return mcpResponse({
      text:
        opportunities.length === 0
          ? "No content opportunities yet. Find them from the Content studio."
          : opportunities
              .map(
                (o) =>
                  `- ${o.query} [${o.recommendedAction}] ${o.impressions} impressions, ${o.clicks} clicks, position ${o.position.toFixed(1)} id:${o.id}`,
              )
              .join("\n"),
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content`,
      ),
      structuredContent: { opportunities },
    });
  }),
};

export const listContentDraftsTool = {
  name: "list_content_drafts",
  config: {
    title: "List content drafts",
    description:
      "List a project's content drafts with status (draft, approved, published). A draft is only public after a person approves it and publishes it in the app.",
    inputSchema: projectInput,
    outputSchema: z.looseObject({
      drafts: z.array(z.looseObject({ id: z.string() })),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const assets = await ContentService.listAssets(args.projectId);
    const drafts = assets.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      revision: a.revision,
      generator: a.generator,
    }));
    return mcpResponse({
      text:
        drafts.length === 0
          ? "No drafts yet."
          : drafts
              .map(
                (d) =>
                  `- ${d.title} [${d.status}] revision ${d.revision} id:${d.id}`,
              )
              .join("\n"),
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content`,
      ),
      structuredContent: { drafts },
    });
  }),
};

const draftInput = {
  projectId: projectIdSchema,
  assetId: z.string().min(1).describe("Draft id from list_content_drafts."),
} as const;

export const getContentQualityChecksTool = {
  name: "get_content_quality_checks",
  config: {
    title: "Get content quality checks",
    description:
      "Return the stored quality checks for a draft's current revision (placeholders, unsourced claims, fabricated experience, link validity, availability, structure, metadata, duplicate intent) and whether any blocking check fails.",
    inputSchema: draftInput,
    outputSchema: z.looseObject({
      checks: z.array(z.looseObject({ key: z.string() })),
      blocked: z.boolean(),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; assetId: string }, context) => {
      const detail = await ContentService.getAssetDetail(
        args.projectId,
        args.assetId,
      );
      const blocked = detail.checks.some(
        (c) => c.severity === "block" && !c.passed,
      );
      return mcpResponse({
        text: detail.checks
          .map(
            (c) =>
              `- ${c.passed ? "pass" : c.severity === "block" ? "BLOCKED" : "warn"} ${c.key}: ${c.detail}`,
          )
          .join("\n"),
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/content`,
        ),
        structuredContent: { checks: detail.checks, blocked },
      });
    },
  ),
};

export const getContentPerformanceTool = {
  name: "get_content_performance",
  config: {
    title: "Get content performance",
    description:
      "Search Console results for the project's published articles over the last 28 days, with refresh suggestions. Observations only: it does not claim an article caused any change.",
    inputSchema: projectInput,
    outputSchema: z.looseObject({
      articles: z.array(z.looseObject({ assetId: z.string() })),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const { articles } = await getContentPerformance(args.projectId);
    return mcpResponse({
      text:
        articles.length === 0
          ? "No published articles yet."
          : articles
              .map(
                (a) =>
                  `- ${a.title}: ${a.current ? `${a.current.clicks} clicks, ${a.current.impressions} impressions` : (a.note ?? a.status)}`,
              )
              .join("\n"),
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content`,
      ),
      structuredContent: { articles },
    });
  }),
};

const createDraftInput = {
  projectId: projectIdSchema,
  opportunityId: z
    .string()
    .min(1)
    .describe("Opportunity id from list_content_opportunities."),
  generator: z
    .enum(["template", "llm"])
    .optional()
    .describe(
      "llm writes with the workspace's AI provider; template is an outline. Defaults to template.",
    ),
} as const;

export const createContentDraftTool = {
  name: "create_content_draft",
  config: {
    title: "Create a content draft",
    description:
      "Create a brief and an unpublished draft for an opportunity. The draft stays private: a person must review, approve and publish it in the app. Placeholders mark facts the store data does not hold.",
    inputSchema: createDraftInput,
    outputSchema: z.looseObject({
      assetId: z.string(),
      status: z.string(),
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
        opportunityId: string;
        generator?: "template" | "llm";
      },
      context,
    ) => {
      // Drafting can spend the workspace's AI budget, so it needs the same
      // role as the app's write actions.
      if (!hasOrgPermission(context.auth.role, { integration: ["manage"] })) {
        throw new AppError(
          "FORBIDDEN",
          "Your organization role does not allow creating content drafts.",
        );
      }
      try {
        const detail = await ContentService.createBriefAndDraft(
          {
            projectId: args.projectId,
            organizationId: context.auth.organizationId,
            userId: context.auth.userId,
          },
          args.opportunityId,
          args.generator ?? "template",
        );
        return mcpResponse({
          text: `Created draft "${detail.asset.title}" (id:${detail.asset.id}), status ${detail.asset.status}. It is not public; a person must approve and publish it in the app.`,
          meta: buildProjectMeta(
            context,
            args.projectId,
            `/p/${args.projectId}/content`,
          ),
          structuredContent: {
            assetId: detail.asset.id,
            status: detail.asset.status,
          },
        });
      } catch (error) {
        if (error instanceof ContentRefusal) {
          throw new AppError("VALIDATION_ERROR", error.message);
        }
        throw error;
      }
    },
  ),
};
