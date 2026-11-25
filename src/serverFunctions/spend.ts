import { createServerFn } from "@tanstack/react-start";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  SpendLimitRefusal,
  SpendService,
} from "@/server/features/spend/services/SpendService";
import {
  limitsToSave,
  limitsToShow,
  UsageDisplayService,
} from "@/server/features/spend/services/UsageDisplayService";
import type { SpendLimits } from "@/server/features/spend/types";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";

const projectScoped = z.object({ projectId: z.string().min(1) });

// null clears a limit. Zod bounds the values; the service validates again.
const limitsSchema = projectScoped.extend({
  dailyUsd: z.number().min(0).max(1_000_000).nullable(),
  monthlyUsd: z.number().min(0).max(1_000_000).nullable(),
  scheduledJobsPerDay: z.number().int().min(0).max(100_000).nullable(),
});

export type SpendResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

export const getSpendOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) => {
    const display = await UsageDisplayService.forOrganization(
      context.organizationId,
    );
    const stored = await SpendService.getLimits(context.projectId);
    const shown = limitsToShow(display, stored);
    // Recorded provider spend is only sent to a workspace that is shown it.
    const spend = display.showProviderCosts
      ? await SpendService.getSpend(context.projectId)
      : null;
    return { display, spend, ...shown };
  });

// Which usage details this workspace is shown: provider charges, a free
// allowance, or neither. Presentation only.
export const getUsageDisplay = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(({ context }) =>
    UsageDisplayService.forOrganization(context.organizationId),
  );

export const setSpendLimits = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(limitsSchema)
  .handler(async ({ data, context }): Promise<SpendResult<SpendLimits>> => {
    requireOrgPermission(context, { workspace: ["manage"] });
    try {
      const display = await UsageDisplayService.forOrganization(
        context.organizationId,
      );
      const requested = {
        dailyUsd: data.dailyUsd,
        monthlyUsd: data.monthlyUsd,
        scheduledJobsPerDay: data.scheduledJobsPerDay,
      };
      const toSave = limitsToSave(
        display,
        await SpendService.getLimits(context.projectId),
        requested,
      );
      const limits = await SpendService.setLimits(
        {
          projectId: context.projectId,
          organizationId: context.organizationId,
          userId: context.userId,
        },
        toSave,
      );
      await AuditLogService.recordUser(
        context,
        "spend.limits_changed",
        "Changed the project's spend limits",
        { projectId: context.projectId },
      );
      return { ok: true, data: limitsToShow(display, limits).limits };
    } catch (error) {
      if (error instanceof SpendLimitRefusal) {
        return { ok: false, reason: error.message };
      }
      throw error;
    }
  });
