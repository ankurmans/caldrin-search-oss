import { z } from "zod";
import { CommandCentreService } from "@/server/features/command-centre/services/CommandCentreService";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { MonitoringService } from "@/server/features/monitoring/services/MonitoringService";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

// Read-only views of what the project Dashboard shows. They read stored
// data and never call a paid provider, so they cost nothing and respect the
// same project access as the app. Approving a change, running work and changing
// spend limits stay in the app behind a person's approval.

const projectInput = { projectId: projectIdSchema } as const;
const readOnly = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;

export const getSearchCommandCentreTool = {
  name: "get_search_command_center",
  config: {
    title: "Get the project Dashboard",
    description:
      "Summarize a project from stored data: the top open opportunities with their evidence, AI Search visibility for the tracked prompts (with whether it is comparable to the earlier period), rank-check status, work awaiting approval or follow-up, audit result and spend against limits. Uses no credits and calls no provider. A section that cannot be read comes back null.",
    inputSchema: projectInput,
    outputSchema: z.looseObject({
      generatedAt: z.string(),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const summary = await CommandCentreService.get({
      projectId: args.projectId,
      domain: context.project?.domain ?? null,
    });
    const open = summary.opportunities?.open ?? 0;
    const pending = summary.execution?.pendingApprovals ?? 0;
    return mcpResponse({
      text: `${open} open opportunities, ${pending} changes awaiting approval. Details are in the structured result.`,
      meta: buildProjectMeta(context, args.projectId, `/p/${args.projectId}`),
      structuredContent: summary,
    });
  }),
};

export const listChangesAndApprovalsTool = {
  name: "list_changes_and_approvals",
  config: {
    title: "List changes and approvals",
    description:
      "List the project's change ledger, newest first: each proposed change with its status (proposed, approved, executed, failed, rejected), target URL and approval details. Observations recorded after a change are readings, not proof it caused them. Approving or running a change happens in the app.",
    inputSchema: {
      ...projectInput,
      status: z
        .enum(["proposed", "approved", "executed", "failed", "rejected"])
        .optional()
        .describe("Only changes with this status."),
      limit: z.number().int().min(1).max(100).default(25),
    },
    outputSchema: z.looseObject({
      changes: z.array(z.looseObject({ id: z.string() })),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        status?: "proposed" | "approved" | "executed" | "failed" | "rejected";
        limit: number;
      },
      context,
    ) => {
      const entries = await LedgerService.listEntries(args.projectId, {
        status: args.status,
        limit: args.limit,
      });
      const changes = entries.map((entry) => ({
        id: entry.id,
        status: entry.status,
        kind: entry.kind,
        proposedAction: entry.proposedAction,
        targetUrl: entry.targetUrl,
        approvedAt: entry.approvedAt,
        executedAt: entry.executedAt,
        finalDecision: entry.finalDecision,
        measurementWindowDays: entry.measurementWindowDays,
      }));
      return mcpResponse({
        text:
          changes.length === 0
            ? "No changes recorded."
            : changes
                .map(
                  (change) =>
                    `- [${change.status}] ${change.proposedAction} id:${change.id}`,
                )
                .join("\n"),
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/changes`,
        ),
        structuredContent: { changes },
      });
    },
  ),
};

export const getSpendAndLimitsTool = {
  name: "get_spend_and_limits",
  config: {
    title: "Get spend and limits",
    description:
      "Provider cost recorded for the project today and this month, by provider, and the daily and monthly limits that stop paid work. A null limit means none is set. Limits are changed in Project Settings, never by an agent.",
    inputSchema: projectInput,
    outputSchema: z.looseObject({
      spend: z.looseObject({ todayUsd: z.number(), monthUsd: z.number() }),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const [spend, limits] = await Promise.all([
      SpendService.getSpend(args.projectId),
      SpendService.getLimits(args.projectId),
    ]);
    return mcpResponse({
      text: `Spent $${spend.todayUsd.toFixed(2)} today and $${spend.monthUsd.toFixed(2)} this month. Limits: daily ${limits.dailyUsd ?? "none"}, monthly ${limits.monthlyUsd ?? "none"}.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/settings/limits`,
      ),
      structuredContent: { spend, limits },
    });
  }),
};

export const listMonitoringAlertsTool = {
  name: "list_monitoring_alerts",
  config: {
    title: "List alerts",
    description:
      "List the project's monitoring alerts, newest first, with the unread count. Each alert says what moved and whether the periods compared are comparable. Marking alerts read happens in the app.",
    inputSchema: {
      ...projectInput,
      limit: z.number().int().min(1).max(50).default(20),
    },
    outputSchema: z.looseObject({
      unread: z.number(),
      alerts: z.array(z.looseObject({ id: z.string() })),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; limit: number }, context) => {
      const { alerts, unread } = await MonitoringService.listAlerts(
        args.projectId,
        { limit: args.limit, offset: 0 },
      );
      return mcpResponse({
        text:
          alerts.length === 0
            ? "No alerts."
            : `${unread} unread.\n${alerts.map((alert) => `- ${alert.title}${alert.readAt ? "" : " (unread)"}`).join("\n")}`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/alerts`,
        ),
        structuredContent: { unread, alerts },
      });
    },
  ),
};
