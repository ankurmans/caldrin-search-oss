import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { rotateAttributionKey } from "@/server/features/attribution/services/attributionKeys";
import {
  addAttributionBrand,
  addAttributionProperty,
  addAttributionSourceRule,
  getAttributionSetup,
  getInstallStatus,
  removeAttributionProperty,
  removeAttributionSourceRule,
  saveAttributionSettings,
} from "@/server/features/attribution/services/attributionSetup";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  consentSnippet,
  installSnippet,
  serverEventExample,
} from "@/shared/attribution/snippet";
import {
  attributionBrandSchema,
  attributionIdSchema,
  attributionKeyKindSchema,
  attributionProjectSchema,
  attributionPropertySchema,
  attributionSettingsSchema,
  attributionSourceRuleSchema,
} from "@/types/schemas/attribution";

export const getAttributionSetupFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionProjectSchema)
  .handler(async ({ context }) => {
    const setup = await getAttributionSetup(context.projectId);
    const origin = getPublicOrigin(getRequest());
    return {
      ...setup,
      sitePlatform:
        context.project.platformOverride ??
        context.project.detectedPlatform ??
        "unknown",
      snippets: {
        install: setup.publicKey
          ? installSnippet(origin, setup.publicKey, setup.settings.consentMode)
          : null,
        consent: consentSnippet(),
        serverEvent: serverEventExample(origin),
      },
    };
  });

export const getAttributionInstallStatusFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionProjectSchema)
  .handler(({ context }) => getInstallStatus(context.projectId));

/** The new key is returned once for a secret key; the previous key stops working. */
export const rotateAttributionKeyFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionKeyKindSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    const result = await rotateAttributionKey(context.projectId, data.kind);
    await AuditLogService.recordUser(
      context,
      "attribution.key_rotated",
      `Created or replaced the ${data.kind} attribution key`,
      { projectId: context.projectId },
    );
    return data.kind === "secret" ? result : { key: null };
  });

export const saveAttributionSettingsFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionSettingsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await saveAttributionSettings(
      context.projectId,
      data,
      context.userId,
    );
    await AuditLogService.recordUser(
      context,
      "attribution.settings_changed",
      `Attribution settings: ${data.lookbackDays}-day lookback, ${data.consentMode} consent, ${data.reportingCurrency}`,
      { projectId: context.projectId },
    );
    return result;
  });

export const addAttributionPropertyFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionPropertySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await addAttributionProperty(context.projectId, data);
    await AuditLogService.recordUser(
      context,
      "attribution.property_changed",
      `Added website ${data.host} to attribution`,
      { projectId: context.projectId },
    );
    return result;
  });

export const removeAttributionPropertyFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionIdSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await removeAttributionProperty(context.projectId, data.id);
    await AuditLogService.recordUser(
      context,
      "attribution.property_changed",
      "Removed a website from attribution",
      { projectId: context.projectId },
    );
  });

export const addAttributionBrandFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionBrandSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await addAttributionBrand(context.projectId, data.name);
    await AuditLogService.recordUser(
      context,
      "attribution.brand_changed",
      `Added brand ${data.name} to attribution`,
      { projectId: context.projectId },
    );
    return result;
  });

export const addAttributionSourceRuleFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionSourceRuleSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const { projectId: _project, ...rule } = data;
    await addAttributionSourceRule(context.projectId, rule, context.userId);
    await AuditLogService.recordUser(
      context,
      "attribution.rule_changed",
      `Added source rule ${data.matchKind} = ${data.pattern} as ${data.sourceLabel}`,
      { projectId: context.projectId },
    );
  });

export const removeAttributionSourceRuleFn = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(attributionIdSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await removeAttributionSourceRule(
      context.projectId,
      data.id,
      context.userId,
    );
    await AuditLogService.recordUser(
      context,
      "attribution.rule_changed",
      "Removed a source rule",
      { projectId: context.projectId },
    );
  });
