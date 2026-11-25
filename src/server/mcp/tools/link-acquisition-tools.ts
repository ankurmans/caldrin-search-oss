/* eslint-disable max-lines -- the link acquisition MCP tools are kept in one module */
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { LinkDiscoveryService } from "@/server/features/link-acquisition/services/LinkDiscoveryService";
import { LinkGapService } from "@/server/features/link-acquisition/services/LinkGapService";
import { LinkOutreachService } from "@/server/features/link-acquisition/services/LinkOutreachService";
import { LinkProspectService } from "@/server/features/link-acquisition/services/LinkProspectService";
import { LinkReportService } from "@/server/features/link-acquisition/services/LinkReportService";
import { LinkVerificationService } from "@/server/features/link-acquisition/services/LinkVerificationService";
import type { LinkAcquisitionContext } from "@/server/features/link-acquisition/services/linkAcquisitionShared";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import type { CustomerContext } from "@/server/lib/customer-context";
import { AppError } from "@/server/lib/errors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable } from "@/server/mcp/table";
import {
  LINK_CAMPAIGN_MODES,
  LINK_PROSPECT_STATUS_LABELS,
} from "@/shared/link-acquisition";
import {
  linkGapQuerySchema,
  linkGapRunInputSchema,
  linkMentionInputSchema,
  linkRecoveryInputSchema,
  prospectListQuerySchema,
} from "@/types/schemas/link-acquisition";

// Link acquisition for agents. Everything runs as the "mcp" actor through the
// same services as the app. Reads cost nothing; the one paid call needs the
// cost ceiling the person approved. There is deliberately no tool to approve
// outreach, mark it sent, or record a reply: those stay with a person, and the
// service refuses them for an agent even if called.

const readOnly = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;
const write = {
  readOnlyHint: false,
  openWorldHint: false,
  destructiveHint: false,
} as const;
const looseResult = z.looseObject({ ...optionalMetaOutputSchema });

function linkContext(
  context: { billing: CustomerContext },
  projectId: string,
): LinkAcquisitionContext {
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

function refusal(text: string) {
  return mcpResponse({
    text,
    structuredContent: { refused: true, reason: text },
  });
}

async function guarded<T>(fn: () => Promise<T>) {
  try {
    return { ok: true, value: await fn() } as const;
  } catch (error) {
    if (
      error instanceof OpportunityRefusal ||
      error instanceof SpendLimitRefusal
    ) {
      return { ok: false, response: refusal(error.message) } as const;
    }
    throw error;
  }
}

const pathFor = (projectId: string) => `/p/${projectId}/backlinks`;

export const findLinkGapsTool = {
  name: "find_link_gaps",
  config: {
    title: "Find link gaps",
    description:
      "Find sites that link to up to 5 competitors but not to the project. Without maxCostUsd this returns the cost estimate and spends nothing. To run it, pass maxCostUsd (the estimate the person approved): the run is refused if the fresh estimate is higher, if it would pass the project's spend limits, or if one already ran today and confirmRepeat is not set. The provider returns counts per referring domain, not exact pages; exact linking pages are a separate paid read in the app. Read results with get_link_gap.",
    inputSchema: {
      projectId: projectIdSchema,
      ...linkGapRunInputSchema.shape,
      maxCostUsd: z.number().positive().optional(),
      confirmRepeat: z.boolean().optional(),
    },
    outputSchema: z.looseObject({
      ran: z.boolean(),
      estimatedUsd: z.number().nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: { ...write, openWorldHint: true },
  },
  handler: withMcpProjectAuth(
    async (
      args: z.infer<typeof linkGapRunInputSchema> & {
        projectId: string;
        maxCostUsd?: number;
        confirmRepeat?: boolean;
      },
      context,
    ) => {
      const ctx = linkContext(context, args.projectId);
      const { projectId, maxCostUsd, confirmRepeat, ...input } = args;
      const meta = buildProjectMeta(context, projectId, pathFor(projectId));
      const quote = await LinkGapService.estimate(ctx, input);
      if (!quote.available || quote.estimatedUsd === null) {
        return mcpResponse({
          text: `${quote.reason ?? "The link gap cannot run."} Nothing was fetched.`,
          meta,
          structuredContent: { ran: false, estimatedUsd: quote.estimatedUsd },
        });
      }
      if (maxCostUsd === undefined) {
        return mcpResponse({
          text: `Estimated $${quote.estimatedUsd.toFixed(2)} for ${quote.providerReads} provider reads (${quote.competitors.join(", ")}). ${quote.ranToday ? `A link gap already ran today for $${quote.ranToday.costUsd.toFixed(2)}; set confirmRepeat to run another. ` : ""}Nothing was fetched. Pass maxCostUsd to run it.`,
          meta,
          structuredContent: { ran: false, estimatedUsd: quote.estimatedUsd },
        });
      }
      requireManage(context.auth.role);
      if (quote.estimatedUsd > maxCostUsd) {
        return refusal(
          `The fresh estimate $${quote.estimatedUsd.toFixed(2)} is above maxCostUsd $${maxCostUsd.toFixed(2)}. Nothing was fetched.`,
        );
      }
      const outcome = await guarded(() =>
        LinkGapService.run(ctx, input, { repeat: confirmRepeat === true }),
      );
      if (!outcome.ok) return outcome.response;
      const result = outcome.value;
      return mcpResponse({
        text: `Stored ${result.rowCount} referring domains${result.partial ? " (some reads failed)" : ""}. Charged about $${result.costUsd.toFixed(2)}. Read them with get_link_gap.`,
        meta,
        structuredContent: {
          ran: true,
          runId: result.runId,
          rowCount: result.rowCount,
          costUsd: result.costUsd,
          estimatedUsd: quote.estimatedUsd,
        },
      });
    },
  ),
};

export const getLinkGapTool = {
  name: "get_link_gap",
  config: {
    title: "Get a link gap",
    description:
      "Stored link gap candidates for the project with their qualification: score, Pursue/Review/Skip, why found, why relevant, why realistic, next action, confidence and limitations. Domain Rank is the provider's 0 to 1000 scale and, like spam score, only moves the score. Competitor counts are provider aggregates per domain, not exact pages; evidence lists exact pages only where they were read. Uses no credits.",
    inputSchema: { projectId: projectIdSchema, ...linkGapQuerySchema.shape },
    outputSchema: looseResult,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(
    async (
      args: z.infer<typeof linkGapQuerySchema> & { projectId: string },
      context,
    ) => {
      const { projectId, ...query } = args;
      const data = await LinkGapService.list(projectId, query);
      const meta = buildProjectMeta(context, projectId, pathFor(projectId));
      if (!data) {
        return mcpResponse({
          text: "No link gap has been run for this project. Use find_link_gaps.",
          meta,
          structuredContent: { total: 0, rows: [] },
        });
      }
      return mcpResponse({
        text: [
          `${data.total} candidates from run ${data.run.id} (${data.run.targetDomain} against ${data.competitors.join(", ")}).`,
          formatMcpTable(data.rows, [
            { header: "Domain", value: (r) => r.referringDomain },
            { header: "Competitors", value: (r) => r.competitorCount },
            { header: "Rank (0-1000)", value: (r) => r.domainRank },
            {
              header: "Score",
              value: (r) => Math.round(r.qualification.score),
            },
            {
              header: "Recommendation",
              value: (r) => r.qualification.recommendation,
            },
            { header: "Next action", value: (r) => r.qualification.nextAction },
          ]),
        ].join("\n"),
        meta,
        structuredContent: { ...data },
      });
    },
  ),
};

export const saveLinkProspectsTool = {
  name: "save_link_prospects",
  config: {
    title: "Save link prospects",
    description:
      "Save sites from a link gap run as prospects. Sites already saved are skipped. A site whose links carry rel=sponsored is filed as sponsored distribution, never as earned. Needs manage access. Uses no credits.",
    inputSchema: {
      projectId: projectIdSchema,
      runId: z.string().min(1),
      domains: z.array(z.string().min(1).max(253)).min(1).max(100),
      campaignMode: z.enum(LINK_CAMPAIGN_MODES).default("earned_editorial"),
    },
    outputSchema: looseResult,
    annotations: write,
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        runId: string;
        domains: string[];
        campaignMode: (typeof LINK_CAMPAIGN_MODES)[number];
      },
      context,
    ) => {
      requireManage(context.auth.role);
      const { projectId, ...input } = args;
      const outcome = await guarded(() =>
        LinkProspectService.saveFromGap(linkContext(context, projectId), input),
      );
      if (!outcome.ok) return outcome.response;
      return mcpResponse({
        text: `${outcome.value.created} saved, ${outcome.value.alreadySaved} already saved, ${outcome.value.filedAsSponsored} filed as sponsored.`,
        meta: buildProjectMeta(context, projectId, pathFor(projectId)),
        structuredContent: { ...outcome.value },
      });
    },
  ),
};

export const listLinkProspectsTool = {
  name: "list_link_prospects",
  config: {
    title: "List link prospects",
    description:
      "Link prospects with status, discovery method, campaign type, score, target page and due date, plus counts per status. Uses no credits.",
    inputSchema: {
      projectId: projectIdSchema,
      ...prospectListQuerySchema.shape,
    },
    outputSchema: looseResult,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(
    async (
      args: z.infer<typeof prospectListQuerySchema> & { projectId: string },
      context,
    ) => {
      const { projectId, ...query } = args;
      const data = await LinkProspectService.list(projectId, query);
      return mcpResponse({
        text: [
          `${data.total} prospects.`,
          formatMcpTable(data.rows, [
            { header: "Id", value: (r) => r.id },
            { header: "Site", value: (r) => r.referringDomain },
            {
              header: "Status",
              value: (r) => LINK_PROSPECT_STATUS_LABELS[r.status],
            },
            { header: "Campaign", value: (r) => r.campaignMode },
            { header: "Score", value: (r) => r.score },
            { header: "Target", value: (r) => r.targetUrl },
          ]),
        ].join("\n"),
        meta: buildProjectMeta(context, projectId, pathFor(projectId)),
        structuredContent: { ...data },
      });
    },
  ),
};

export const getLinkProspectTool = {
  name: "get_link_prospect",
  config: {
    title: "Inspect a link prospect",
    description:
      "One prospect with its signals, status history, outreach drafts and the evidence recorded for its site. Uses no credits.",
    inputSchema: { projectId: projectIdSchema, prospectId: z.string().min(1) },
    outputSchema: looseResult,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; prospectId: string }, context) => {
      const detail = await LinkProspectService.detail(
        args.projectId,
        args.prospectId,
      );
      const meta = buildProjectMeta(
        context,
        args.projectId,
        pathFor(args.projectId),
      );
      if (!detail) return refusal("That prospect was not found.");
      const drafts = await LinkOutreachService.list(
        args.projectId,
        args.prospectId,
      );
      return mcpResponse({
        text: `${detail.prospect.referringDomain}: ${LINK_PROSPECT_STATUS_LABELS[detail.prospect.status]}, ${detail.events.length} history entries, ${drafts.length} drafts.`,
        meta,
        structuredContent: { ...detail, drafts },
      });
    },
  ),
};

export const qualifyLinkProspectsTool = {
  name: "qualify_link_prospects",
  config: {
    title: "Qualify link prospects",
    description:
      "Requalify discovered prospects from the link gap they came from, using the project's current qualification settings. Pursue and Review become Qualified; Skip becomes Rejected with the reason on its history. Prospects without link gap data are left as they are. Needs manage access. Uses no credits.",
    inputSchema: {
      projectId: projectIdSchema,
      prospectIds: z.array(z.string().min(1)).min(1).max(100),
    },
    outputSchema: looseResult,
    annotations: write,
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; prospectIds: string[] }, context) => {
      requireManage(context.auth.role);
      const outcome = await guarded(() =>
        LinkProspectService.qualify(
          linkContext(context, args.projectId),
          args.prospectIds,
        ),
      );
      if (!outcome.ok) return outcome.response;
      return mcpResponse({
        text: "Qualification updated from the current settings.",
        meta: buildProjectMeta(
          context,
          args.projectId,
          pathFor(args.projectId),
        ),
        structuredContent: { ...outcome.value },
      });
    },
  ),
};

export const createLinkOpportunityTool = {
  name: "create_link_opportunity",
  config: {
    title: "Create an opportunity for a link prospect",
    description:
      "When no page on the site fits what a prospect's competitors were linked for, store a Search Opportunity for the missing page, optionally with a Content Studio brief and draft. Refused when an existing page already matches, so a new article is never written when a page could be linked. Needs manage access. Uses no credits for the opportunity; a brief uses the project's normal draft allowance.",
    inputSchema: {
      projectId: projectIdSchema,
      prospectId: z.string().min(1),
      withBrief: z.boolean().default(false),
    },
    outputSchema: looseResult,
    annotations: write,
  },
  handler: withMcpProjectAuth(
    async (
      args: { projectId: string; prospectId: string; withBrief: boolean },
      context,
    ) => {
      requireManage(context.auth.role);
      const outcome = await guarded(() =>
        LinkProspectService.createAssetOpportunity(
          linkContext(context, args.projectId),
          { prospectId: args.prospectId, withBrief: args.withBrief },
        ),
      );
      if (!outcome.ok) return outcome.response;
      return mcpResponse({
        text: `Opportunity ${outcome.value.opportunityId} stored for topic "${outcome.value.topic}". Nothing was published.`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/opportunities`,
        ),
        structuredContent: { ...outcome.value },
      });
    },
  ),
};

export const draftLinkOutreachTool = {
  name: "draft_link_outreach",
  config: {
    title: "Draft link outreach",
    description:
      "Write an outreach draft for a prospect from the pages on record. The prospect needs a target page. The draft never claims prior contact or knowledge it does not have, and contact details are only what you pass. The draft is not approved and nothing is sent: a person reviews, approves and sends it. There is no tool to approve or send. Needs manage access. Uses no credits.",
    inputSchema: {
      projectId: projectIdSchema,
      prospectId: z.string().min(1),
      contactName: z.string().trim().max(200).optional(),
      contactEmail: z.string().trim().max(320).optional(),
    },
    outputSchema: looseResult,
    annotations: write,
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        prospectId: string;
        contactName?: string;
        contactEmail?: string;
      },
      context,
    ) => {
      requireManage(context.auth.role);
      const { projectId, ...input } = args;
      const outcome = await guarded(() =>
        LinkOutreachService.generate(linkContext(context, projectId), input),
      );
      if (!outcome.ok) return outcome.response;
      return mcpResponse({
        text: `Draft ${outcome.value.draftId} written from ${outcome.value.usedEvidence} recorded linking pages. It needs a person to review and approve it; nothing was sent.`,
        meta: buildProjectMeta(context, projectId, pathFor(projectId)),
        structuredContent: { ...outcome.value },
      });
    },
  ),
};

export const listLinkCampaignActivityTool = {
  name: "list_link_campaign_activity",
  config: {
    title: "List link campaign activity",
    description:
      "Outreach drafts with their events (approved, exported, marked sent, replies) and the program's counts: prospects, qualified, approved, sent, replies logged, links confirmed live, verified referring domains, earned versus sponsored, removed, and recorded cost. Counts of activity only; no ranking or traffic effect is claimed. Uses no credits.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: looseResult,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const [report, drafts] = await Promise.all([
      LinkReportService.report(args.projectId),
      LinkOutreachService.list(args.projectId),
    ]);
    return mcpResponse({
      text: `${report.prospects} prospects, ${report.sent} messages marked sent, ${report.confirmedLive} links confirmed live.`,
      meta: buildProjectMeta(context, args.projectId, pathFor(args.projectId)),
      structuredContent: { report, drafts },
    });
  }),
};

export const verifyLinkPageTool = {
  name: "verify_link_page",
  config: {
    title: "Verify a link on a page",
    description:
      "Record that a page links, or has promised to link, to a page on the project's site, then fetch it and check for a real hyperlink to that destination. Records the HTTP status, final URL, canonical, anchor, nofollow/sponsored/ugc, surrounding text and the time. A link is confirmed live only when found; a page that cannot be fetched is unverifiable, and a link that was confirmed and later disappears is recorded as removed. Fetches only that page, with the same protections as the site audit; calls no paid provider. Needs manage access.",
    inputSchema: {
      projectId: projectIdSchema,
      urlFrom: z.string().trim().url().max(2048),
      expectedTarget: z.string().trim().url().max(2048),
      campaignMode: z.enum(LINK_CAMPAIGN_MODES).default("earned_editorial"),
      prospectId: z.string().min(1).optional(),
    },
    outputSchema: looseResult,
    annotations: { ...write, openWorldHint: true },
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        urlFrom: string;
        expectedTarget: string;
        campaignMode: (typeof LINK_CAMPAIGN_MODES)[number];
        prospectId?: string;
      },
      context,
    ) => {
      requireManage(context.auth.role);
      const ctx = linkContext(context, args.projectId);
      const outcome = await guarded(async () => {
        const placement = await LinkVerificationService.create(ctx, {
          urlFrom: args.urlFrom,
          expectedTarget: args.expectedTarget,
          campaignMode: args.campaignMode,
          prospectId: args.prospectId,
          state: "promised",
        });
        const result = await LinkVerificationService.verify(
          ctx,
          placement.placement.id,
        );
        return { placementId: placement.placement.id, ...result };
      });
      if (!outcome.ok) return outcome.response;
      return mcpResponse({
        text: `Check result: ${outcome.value.outcome}; the link is now ${outcome.value.state.replace(/_/g, " ")}.${outcome.value.note ? ` ${outcome.value.note}` : ""}`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          pathFor(args.projectId),
        ),
        structuredContent: { ...outcome.value },
      });
    },
  ),
};

export const listAcquiredLinksTool = {
  name: "list_acquired_links",
  config: {
    title: "List acquired links",
    description:
      "Recorded placements with their state (promised, observed, confirmed live, later removed, no longer verifiable) and latest checks. Only a check that found the hyperlink makes a link confirmed live. Uses no credits.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: looseResult,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const placements = await LinkVerificationService.list(args.projectId);
    return mcpResponse({
      text: [
        `${placements.length} recorded links.`,
        formatMcpTable(placements, [
          { header: "From", value: (p) => p.urlFrom },
          { header: "To", value: (p) => p.expectedTarget },
          { header: "State", value: (p) => p.state },
          { header: "Mode", value: (p) => p.campaignMode },
          { header: "Last checked", value: (p) => p.lastCheckedAt },
        ]),
      ].join("\n"),
      meta: buildProjectMeta(context, args.projectId, pathFor(args.projectId)),
      structuredContent: { placements },
    });
  }),
};

export const findRecoverableLinksTool = {
  name: "find_recoverable_links",
  config: {
    title: "Find recoverable links",
    description:
      "Find links the project lost, or links pointing at dead pages on the project's own site, and save the confirmed ones as link prospects. Every candidate is checked by fetching the page, so provider data alone never creates a prospect. Without maxCostUsd this returns the cost estimate and spends nothing. To run it, pass maxCostUsd (the estimate the person approved): the run is refused if the fresh estimate is higher, if it would pass the project's spend limits, or if one already ran today and confirmRepeat is not set. Read the saved prospects with list_link_prospects.",
    inputSchema: {
      projectId: projectIdSchema,
      ...linkRecoveryInputSchema.shape,
      maxCostUsd: z.number().positive().optional(),
      confirmRepeat: z.boolean().optional(),
    },
    outputSchema: z.looseObject({
      ran: z.boolean(),
      estimatedUsd: z.number().nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: { ...write, openWorldHint: true },
  },
  handler: withMcpProjectAuth(
    async (
      args: z.infer<typeof linkRecoveryInputSchema> & {
        projectId: string;
        maxCostUsd?: number;
        confirmRepeat?: boolean;
      },
      context,
    ) => {
      const ctx = linkContext(context, args.projectId);
      const meta = buildProjectMeta(
        context,
        args.projectId,
        pathFor(args.projectId),
      );
      const quote = await LinkDiscoveryService.estimateRecovery(ctx, args.kind);
      if (!quote.available) {
        return mcpResponse({
          text: `${quote.reason ?? "This cannot run."} Nothing was fetched.`,
          meta,
          structuredContent: { ran: false, estimatedUsd: quote.estimatedUsd },
        });
      }
      if (args.maxCostUsd === undefined) {
        return mcpResponse({
          text: `Estimated $${quote.estimatedUsd.toFixed(2)}. ${quote.basis} ${quote.ranToday ? `This already ran today for $${quote.ranToday.costUsd.toFixed(2)}; set confirmRepeat to run another. ` : ""}Nothing was fetched. Pass maxCostUsd to run it.`,
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
      const outcome = await guarded(() =>
        LinkDiscoveryService.runRecovery(ctx, args.kind, {
          repeat: args.confirmRepeat === true,
        }),
      );
      if (!outcome.ok) return outcome.response;
      const r = outcome.value;
      return mcpResponse({
        text: `Checked ${r.read} pages. Saved ${r.created} prospects (${r.alreadySaved} already saved). Not worth pursuing: ${r.alreadyFixed} already fixed, ${r.stillLinking} still linking, ${r.pageGone} page gone. ${r.needsReview} could not be confirmed and need a manual look. Charged about $${r.costUsd.toFixed(2)}.`,
        meta,
        structuredContent: {
          ran: true,
          estimatedUsd: quote.estimatedUsd,
          ...r,
        },
      });
    },
  ),
};

export const checkLinkMentionsTool = {
  name: "check_link_mentions",
  config: {
    title: "Check pages for unlinked mentions",
    description:
      "Fetch up to 20 web pages and save those that name the brand in their visible text but link nowhere to the project's site, with the fetched sentence as evidence. Free: only the pages passed in are fetched, through the same SSRF-safe, robots-respecting fetcher as link verification. It does not search the web for mentions; pass pages you already have, such as results from a search or a mention monitor.",
    inputSchema: {
      projectId: projectIdSchema,
      ...linkMentionInputSchema.shape,
    },
    outputSchema: looseResult,
    annotations: { ...write, openWorldHint: true },
  },
  handler: withMcpProjectAuth(
    async (
      args: z.infer<typeof linkMentionInputSchema> & { projectId: string },
      context,
    ) => {
      requireManage(context.auth.role);
      const meta = buildProjectMeta(
        context,
        args.projectId,
        pathFor(args.projectId),
      );
      const { projectId, ...input } = args;
      const outcome = await guarded(() =>
        LinkDiscoveryService.checkMentions(
          linkContext(context, projectId),
          input,
        ),
      );
      if (!outcome.ok) return outcome.response;
      const r = outcome.value;
      return mcpResponse({
        text: `Read ${r.checked} pages. Saved ${r.created} unlinked mentions (${r.alreadySaved} already saved). ${r.alreadyLinked} already link to the project, ${r.notMentioned} do not mention it, ${r.unreadable} could not be read.`,
        meta,
        structuredContent: { ...r },
      });
    },
  ),
};
