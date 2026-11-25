import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { BasicReportService } from "@/server/features/command-centre/services/BasicReportService";
import { CommandCentreService } from "@/server/features/command-centre/services/CommandCentreService";
import { requireProjectContext } from "@/serverFunctions/middleware";

// Stored observations only: opening the Dashboard never calls a paid
// provider. Fresh data comes from the refresh controls on each workspace.
export const getCommandCentre = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(({ context }) =>
    CommandCentreService.get({
      projectId: context.projectId,
      domain: context.project.domain,
    }),
  );

// One click, no paid provider: the report is written from stored data and the
// free Search Console read.
export const createBasicReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(({ context }) =>
    BasicReportService.create({
      projectId: context.projectId,
      organizationId: context.organizationId,
      userId: context.userId,
      projectName: context.project.name,
      domain: context.project.domain,
    }),
  );
