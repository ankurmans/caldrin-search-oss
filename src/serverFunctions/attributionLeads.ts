import { createServerFn } from "@tanstack/react-start";
import { getCallsReport } from "@/server/features/attribution/services/attributionCalls";
import { getLeadsReport } from "@/server/features/attribution/services/attributionLeads";
import { getBrandRouting } from "@/server/features/attribution/services/attributionRouting";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { attributionReportSchema } from "@/types/schemas/attribution";

export const getAttributionLeadsFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionReportSchema)
  .handler(({ data, context }) =>
    getLeadsReport({ ...data, projectId: context.projectId }),
  );

export const getAttributionRoutingFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionReportSchema)
  .handler(({ data, context }) =>
    getBrandRouting({ ...data, projectId: context.projectId }),
  );

export const getAttributionCallsFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionReportSchema)
  .handler(({ data, context }) =>
    getCallsReport({ ...data, projectId: context.projectId }),
  );
