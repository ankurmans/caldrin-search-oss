import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isClientGuest } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  getClientReportAccess,
  listClientReports,
  setClientReportAccess,
} from "@/server/features/reports/services/ClientReportsService";
import { AppError } from "@/server/lib/errors";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "./middleware";

const reportRef = z.object({
  projectId: z.string().min(1),
  reportId: z.string().min(1),
});

export const getClientReports = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(({ context }) => {
    if (!isClientGuest(context.role)) throw new AppError("FORBIDDEN");
    return listClientReports(
      context.organizationId,
      context.allowedProjectIds ?? [],
    );
  });

export const getReportClientAccess = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(reportRef)
  .handler(({ data, context }) =>
    getClientReportAccess(
      context.organizationId,
      context.projectId,
      data.reportId,
    ),
  );

export const updateReportClientAccess = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    reportRef.extend({ visible: z.boolean(), updatedAt: z.string().min(1) }),
  )
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await setClientReportAccess(context, data);
    return { ok: true as const };
  });
