import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import {
  createPolarConnector,
  createStripeConnector,
  listAttributionConnectors,
  removeAttributionConnector,
} from "@/server/features/attribution/services/attributionConnectors";
import {
  removeAttributionDemo,
  seedAttributionDemo,
} from "@/server/features/attribution/services/attributionDemo";
import { getConversionEvidence } from "@/server/features/attribution/services/attributionEvidence";
import { reusablePosthogKey } from "@/server/features/attribution/services/attributionPosthog";
import { getAttributionHealth } from "@/server/features/attribution/services/attributionHealth";
import { importAttributionCsv } from "@/server/features/attribution/services/attributionImport";
import {
  compareAttributionModels,
  getAttributionOverview,
  listJourneys,
} from "@/server/features/attribution/services/attributionReports";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  attributionCompareSchema,
  attributionConversionSchema,
  attributionCsvSchema,
  attributionDemoSchema,
  attributionIdSchema,
  attributionJourneysSchema,
  attributionProjectSchema,
  attributionReportSchema,
  attributionPaymentConnectorSchema,
} from "@/types/schemas/attribution";

export const getAttributionOverviewFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionReportSchema)
  .handler(({ data, context }) =>
    getAttributionOverview({ ...data, projectId: context.projectId }),
  );

export const compareAttributionModelsFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionCompareSchema)
  .handler(({ data, context }) =>
    compareAttributionModels({ ...data, projectId: context.projectId }),
  );

export const listAttributionJourneysFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionJourneysSchema)
  .handler(({ data, context }) =>
    listJourneys({ ...data, projectId: context.projectId }),
  );

export const getConversionEvidenceFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionConversionSchema)
  .handler(({ data, context }) =>
    getConversionEvidence(context.projectId, data.conversionId),
  );

export const getAttributionHealthFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionDemoSchema)
  .handler(({ data, context }) =>
    getAttributionHealth(context.projectId, data.demo),
  );

export const listAttributionConnectorsFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionProjectSchema)
  .handler(async ({ context }) => ({
    connectors: await listAttributionConnectors(context.projectId),
    reusablePosthog: await reusablePosthogKey(context.projectId),
    webhookBase: `${getPublicOrigin(getRequest())}/api/attribution/webhooks/`,
  }));

export const createPaymentConnectorFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionPaymentConnectorSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const create =
      data.kind === "polar" ? createPolarConnector : createStripeConnector;
    const created = await create(context.projectId, data);
    await AuditLogService.recordUser(
      context,
      "attribution.connector_changed",
      `Added a ${data.kind === "polar" ? "Polar" : "Stripe"} webhook connector (${data.label})`,
      { projectId: context.projectId },
    );
    return created;
  });

export const removeAttributionConnectorFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionIdSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await removeAttributionConnector(context.projectId, data.id);
    await AuditLogService.recordUser(
      context,
      "attribution.connector_changed",
      "Removed a payment connector",
      { projectId: context.projectId },
    );
  });

export const importAttributionCsvFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionCsvSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await importAttributionCsv(context.projectId, data);
    if (!data.dryRun && result.imported)
      await AuditLogService.recordUser(
        context,
        "attribution.imported",
        `Imported ${result.imported.accepted} rows from ${data.label}`,
        { projectId: context.projectId },
      );
    return result;
  });

export const setAttributionDemoFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionDemoSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = data.demo
      ? await seedAttributionDemo(context.projectId)
      : await removeAttributionDemo(context.projectId, context.userId);
    await AuditLogService.recordUser(
      context,
      "attribution.demo_changed",
      data.demo ? "Added labelled demo data" : "Removed demo data",
      { projectId: context.projectId },
    );
    return result;
  });
