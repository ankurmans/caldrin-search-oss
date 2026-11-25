import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  ContextDraftRefusal,
  ContextDraftService,
} from "@/server/features/project-context/services/ContextDraftService";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  PROJECT_CONTEXT_SECTION_KEYS,
  getProjectContextSchema,
  updateProjectContextSchema,
} from "@/types/schemas/projectContext";

export const getProjectContext = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getProjectContextSchema)
  .handler(async ({ context }) =>
    ProjectContextService.getProjectContext(context.projectId),
  );

export const updateProjectContext = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateProjectContextSchema)
  .handler(async ({ data, context }) =>
    // Everything reaching this entry point is a person editing their own
    // project's memory; SAM and MCP writes go through the same service with
    // their own author.
    ProjectContextService.applyContextUpdates(
      context.projectId,
      data.updates,
      "user",
    ),
  );

const draftSchema = getProjectContextSchema.extend({
  fields: z.array(z.enum(PROJECT_CONTEXT_SECTION_KEYS)).min(1),
  notes: z.string().trim().max(1500).optional(),
});

// Reads the website and proposes text for the empty fields. Spends a few cents,
// so it needs the same access as the other paid drafts. Nothing is saved.
export const draftProjectContext = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(draftSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    try {
      return {
        ok: true as const,
        data: await ContextDraftService.draft(
          {
            projectId: context.projectId,
            organizationId: context.organizationId,
            userId: context.userId,
          },
          { fields: data.fields, notes: data.notes },
        ),
      };
    } catch (error) {
      if (
        error instanceof ContextDraftRefusal ||
        error instanceof SpendLimitRefusal
      ) {
        return { ok: false as const, reason: error.message };
      }
      throw error;
    }
  });
