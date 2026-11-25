import { createServerFn } from "@tanstack/react-start";
import { hasOrgPermission } from "@/lib/org-permissions";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import {
  clearBranding,
  getBranding,
  requireShareBranding,
  saveBranding,
} from "@/server/features/branding/branding";
import { getPlatformAccess } from "@/server/features/billing/platformAccess";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { brandingSchema } from "@/types/schemas/branding";

export const getWorkspaceBranding = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    hasOrgPermission(context.role, { workspace: ["manage"] })
      ? {
          canManage: true as const,
          branding: await getBranding(context.organizationId),
          platform: await getPlatformAccess(context.organizationId),
        }
      : { canManage: false as const },
  );

export const saveWorkspaceBranding = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(brandingSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    await requireShareBranding(context.organizationId);
    await saveBranding(context.organizationId, data);
    await AuditLogService.recordUser(
      context,
      "branding.updated",
      `Shared report branding set to ${data.brandName}`,
    );
  });

export const clearWorkspaceBranding = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    await clearBranding(context.organizationId);
    await AuditLogService.recordUser(
      context,
      "branding.updated",
      "Shared report branding removed",
    );
  });
