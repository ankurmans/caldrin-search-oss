import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MonitoringService } from "@/server/features/monitoring/services/MonitoringService";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  getAlertDestinations,
  isSlackWebhookUrl,
  postToSlack,
  saveAlertDestinations,
} from "@/server/features/monitoring/services/monitoringDestinations";
import { AppError } from "@/server/lib/errors";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";

const projectScoped = z.object({ projectId: z.string().min(1) });

export const listProjectAlerts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).max(100_000).default(0),
    }),
  )
  .handler(async ({ data, context }) =>
    MonitoringService.listAlerts(context.projectId, {
      limit: data.limit,
      offset: data.offset,
    }),
  );

export const markProjectAlertsRead = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      alertIds: z.union([
        z.array(z.string().min(1)).min(1).max(100),
        z.literal("all"),
      ]),
    }),
  )
  .handler(async ({ data, context }) => {
    await MonitoringService.markRead(context.projectId, data.alertIds);
    return { ok: true as const };
  });

// Alert destinations cover every project, so a member limited to some
// projects cannot read or change them.
export const getWorkspaceAlertDestinations = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    hasOrgPermission(context.role, { integration: ["manage"] }) &&
    !context.allowedProjectIds
      ? {
          canManage: true as const,
          ...(await getAlertDestinations(context.organizationId)),
        }
      : { canManage: false as const },
  );

export const saveWorkspaceAlertDestinations = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(
    z.object({
      emailEnabled: z.boolean(),
      // Omit to keep the saved webhook, null to remove it.
      slackWebhookUrl: z.string().trim().max(300).nullish(),
    }),
  )
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    if (context.allowedProjectIds) throw new AppError("FORBIDDEN");
    const url = data.slackWebhookUrl;
    if (url) {
      // Only Slack's own host is ever contacted, and a webhook that cannot
      // post is never saved.
      if (!isSlackWebhookUrl(url))
        throw new AppError(
          "VALIDATION_ERROR",
          "Use a Slack incoming webhook URL (https://hooks.slack.com/services/...).",
        );
      await postToSlack(
        url,
        "Caldrin Search alerts are connected to this channel.",
      ).catch(() => {
        throw new AppError(
          "VALIDATION_ERROR",
          "Slack did not accept a test message at that webhook URL.",
        );
      });
    }
    return saveAlertDestinations(context.organizationId, {
      emailEnabled: data.emailEnabled,
      slackWebhookUrl: url === "" ? null : url,
    });
  });
