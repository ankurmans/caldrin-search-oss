import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { AUDIT_ACTOR_KINDS } from "@/shared/audit-log";

const filterSchema = z.object({
  // An exact action ("project.created") or a group ending in "." ("links.").
  action: z.string().max(60).optional(),
  actorKind: z.enum(AUDIT_ACTOR_KINDS).optional(),
  projectId: z.string().min(1).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

const listSchema = filterSchema.extend({
  before: z
    .object({ createdAt: z.string().max(40), id: z.string().max(80) })
    .optional(),
});

// Workspace owners and admins only: the log names people and what they did.
export const getAuditLog = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(listSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { organization: ["update"] });
    return AuditLogService.list(context.organizationId, data);
  });

export const exportAuditLog = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(filterSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { organization: ["update"] });
    return AuditLogService.exportCsv(context.organizationId, data);
  });
