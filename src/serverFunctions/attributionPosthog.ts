import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import {
  createPosthogConnector,
  importPosthog,
  PosthogError,
  testPosthogConnector,
} from "@/server/features/attribution/services/attributionPosthog";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  attributionIdSchema,
  attributionProjectSchema,
  posthogCredentialsSchema,
} from "@/types/schemas/attribution";

// Without a key, region and key come from the workspace's existing connection.
const createSchema = attributionProjectSchema
  .extend({ label: z.string().trim().min(1).max(80) })
  .extend(posthogCredentialsSchema.shape)
  .extend({
    region: posthogCredentialsSchema.shape.region.optional(),
    apiKey: posthogCredentialsSchema.shape.apiKey.optional(),
  });

const importSchema = attributionIdSchema.extend({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dryRun: z.boolean(),
});

/** The browser only gets error codes from a throw, so a reason in words travels as a result. */
async function withReason<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() };
  } catch (error) {
    if (error instanceof PosthogError)
      return { ok: false as const, reason: error.message };
    throw error;
  }
}

export const createPosthogConnectorFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const created = await withReason(() =>
      createPosthogConnector(context.projectId, data),
    );
    if (created.ok)
      await AuditLogService.recordUser(
        context,
        "attribution.connector_changed",
        `Added a PostHog connector (${data.label})`,
        { projectId: context.projectId },
      );
    return created;
  });

export const testPosthogConnectorFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionIdSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return withReason(() => testPosthogConnector(context.projectId, data.id));
  });

export const importPosthogFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(importSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await withReason(() =>
      importPosthog(context.projectId, data.id, data),
    );
    if (result.ok && !data.dryRun)
      await AuditLogService.recordUser(
        context,
        "attribution.posthog_imported",
        `Imported PostHog page views ${data.from} to ${data.to}`,
        { projectId: context.projectId },
      );
    return result;
  });
