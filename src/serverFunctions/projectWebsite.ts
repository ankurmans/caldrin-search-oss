import { waitUntil } from "cloudflare:workers";
import { captureServerEvent } from "@/server/lib/posthog";
import { createServerFn } from "@tanstack/react-start";
import { ProjectWebsiteService } from "@/server/features/projects/services/ProjectWebsiteService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  researchProjectWebsiteSchema,
  saveProjectWebsiteSetupSchema,
} from "@/types/schemas/projectWebsite";

export const researchProjectWebsite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(researchProjectWebsiteSchema)
  .handler(({ data, context }) =>
    ProjectWebsiteService.research(context.projectId, data.website, context),
  );
export const saveProjectWebsiteSetup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(saveProjectWebsiteSetupSchema)
  .handler(async ({ data, context }) => {
    const { project } = await ProjectWebsiteService.save(
      { ...data, projectId: context.projectId },
      context,
      "user",
      { runSeededTracking: true },
    );
    if (!context.project.domain) {
      waitUntil(
        captureServerEvent({
          distinctId: context.userId,
          organizationId: context.organizationId,
          event: "onboarding:site_added",
          properties: { project_id: project.id },
        }),
      );
    }
    return project;
  });
