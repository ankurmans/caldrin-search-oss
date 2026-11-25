import { captureServerEvent } from "@/server/lib/posthog";
import { waitUntil } from "cloudflare:workers";
import { ProjectFirstReadService } from "@/server/features/dashboard/services/ProjectFirstReadService";

import { DashboardSiteService } from "@/server/features/dashboard/services/DashboardSiteService";
import { AppError } from "@/server/lib/errors";
import { createServerFn } from "@tanstack/react-start";
import { ActivationRepository } from "@/server/features/activation/repositories/ActivationRepository";
import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  dashboardProjectInputSchema,
  dashboardBacklinksInputSchema,
  onboardingGoalSchema,
  firstReadEngagementSchema,
  dashboardStepDismissalSchema,
} from "@/types/schemas/dashboard";

export const getDashboardActivation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(({ context }) =>
    DashboardService.getActivation({
      userId: context.userId,
      projectId: context.projectId,
      organizationId: context.organizationId,
      domain: context.project.domain,
      platform:
        context.project.platformOverride ??
        context.project.detectedPlatform ??
        "unknown",
    }),
  );

export const getDashboardOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(({ context }) =>
    DashboardService.getOverview({
      projectId: context.projectId,
      domain: context.project.domain,
    }),
  );

// Hides only the optional GA4 pitch on this project's dashboard. The
// integration remains available in Project Settings and a later connection
// makes the dashboard card visible again.
export const dismissDashboardGa4Card = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    await ActivationRepository.markGa4CardDismissed(context.projectId);
    return { ok: true as const };
  });

// Hides only the agent card, for this person on every project in the
// workspace. The checklist's agent step stays.
export const dismissDashboardAgentCard = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    await ActivationRepository.dismissAgentCard(
      context.userId,
      context.projectId,
    );
    return { ok: true as const };
  });

// Skips or restores a setup step for this person on every project in the
// workspace.
export const setDashboardStepDismissed = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardStepDismissalSchema)
  .handler(async ({ context, data }) => {
    await DashboardService.setStepDismissed({
      userId: context.userId,
      organizationId: context.organizationId,
      projectId: context.projectId,
      step: data.step,
      dismissed: data.dismissed,
    });
    return { ok: true };
  });

export const getDashboardKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(({ context }) =>
    DashboardSiteService.getKeywords(context.projectId, context.organizationId),
  );
export const getDashboardBacklinks = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardBacklinksInputSchema)
  .handler(({ context, data }) => {
    if (!context.project.domain)
      throw new AppError(
        "VALIDATION_ERROR",
        "Add your website in project settings first.",
      );
    return DashboardSiteService.getBacklinks(
      { domain: context.project.domain, kind: data.kind },
      context,
    );
  });
export const getDashboardEmergingQueries = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(({ context }) =>
    DashboardSiteService.getEmergingQueries(
      context.projectId,
      context.organizationId,
    ),
  );
export const getDashboardLinkActivity = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(({ context }) => {
    if (!context.project.domain)
      throw new AppError("VALIDATION_ERROR", "Add your website first.");
    return DashboardSiteService.getLinkActivity(
      context.project.domain,
      context,
    );
  });

export const getProjectFirstRead = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(({ context }) => {
    const read = ProjectFirstReadService.get(context.project, context);
    waitUntil(read.catch(() => undefined));
    return read;
  });

export const setOnboardingGoal = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(onboardingGoalSchema)
  .handler(async ({ data, context }) => {
    await DashboardService.setOnboardingGoal(context.projectId, data.goal);
    return { goal: data.goal };
  });

export const markFirstReadEngagement = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(firstReadEngagementSchema)
  .handler(async ({ data, context }) => {
    if (
      await DashboardService.markFirstReadEngagement(
        context.projectId,
        data.milestone,
      )
    ) {
      waitUntil(
        captureServerEvent({
          distinctId: context.userId,
          organizationId: context.organizationId,
          event:
            data.milestone === "firstReadViewedAt"
              ? "onboarding:first_read_shown"
              : "onboarding:first_finding_opened",
          properties: { project_id: context.projectId },
        }),
      );
    }
    return { ok: true };
  });
