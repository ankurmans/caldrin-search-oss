import { createServerFn } from "@tanstack/react-start";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { LinkDiscoveryService } from "@/server/features/link-acquisition/services/LinkDiscoveryService";
import { LinkEvidenceService } from "@/server/features/link-acquisition/services/LinkEvidenceService";
import { LinkGapService } from "@/server/features/link-acquisition/services/LinkGapService";
import { LinkOutreachService } from "@/server/features/link-acquisition/services/LinkOutreachService";
import { LinkProspectService } from "@/server/features/link-acquisition/services/LinkProspectService";
import { LinkReportService } from "@/server/features/link-acquisition/services/LinkReportService";
import { LinkVerificationService } from "@/server/features/link-acquisition/services/LinkVerificationService";
import type { LinkAcquisitionContext } from "@/server/features/link-acquisition/services/linkAcquisitionShared";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  assetOpportunityInputSchema,
  draftIdSchema,
  linkEvidenceInputSchema,
  linkGapQuerySchema,
  linkGapRunInputSchema,
  linkMentionInputSchema,
  linkRecoveryInputSchema,
  outreachEditInputSchema,
  outreachGenerateInputSchema,
  outreachReplyInputSchema,
  placementCreateInputSchema,
  placementIdSchema,
  prospectIdsSchema,
  prospectListQuerySchema,
  prospectUpdateInputSchema,
  qualificationSettingsSchema,
  saveFromAiInputSchema,
  saveFromGapInputSchema,
  saveManualInputSchema,
  suppressionInputSchema,
} from "@/types/schemas/link-acquisition";

const projectScoped = z.object({ projectId: z.string().min(1) });

type Result<T> = { ok: true; data: T } | { ok: false; reason: string };

async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (
      error instanceof OpportunityRefusal ||
      error instanceof SpendLimitRefusal
    ) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

function scopeOf(context: {
  projectId: string;
  organizationId: string;
  userId: string;
  userEmail: string;
}): LinkAcquisitionContext {
  return {
    projectId: context.projectId,
    organizationId: context.organizationId,
    userId: context.userId,
    userEmail: context.userEmail,
  };
}

// ---- Reads of stored data. None of these call a provider. ----

export const getLinkGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ query: linkGapQuerySchema }))
  .handler(({ data, context }) =>
    LinkGapService.list(context.projectId, data.query),
  );

export const exportLinkGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ query: linkGapQuerySchema }))
  .handler(({ data, context }) =>
    LinkGapService.exportRows(context.projectId, data.query),
  );

export const getLinkQualificationSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(({ context }) => LinkGapService.settings(context.projectId));

// ---- Cost previews. No provider call. ----

export const estimateLinkGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: linkGapRunInputSchema }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return LinkGapService.estimate(scopeOf(context), data.input);
  });

export const estimateLinkEvidence = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: linkEvidenceInputSchema }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return attempt(() =>
      LinkEvidenceService.estimate(scopeOf(context), data.input),
    );
  });

export const estimateLinkRecovery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: linkRecoveryInputSchema }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return attempt(() =>
      LinkDiscoveryService.estimateRecovery(scopeOf(context), data.input.kind),
    );
  });

// ---- Paid runs: managers only, re-checked against limits in the service. ----

export const runLinkGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      input: linkGapRunInputSchema,
      repeat: z.boolean().optional(),
    }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return attempt(() =>
      LinkGapService.run(scopeOf(context), data.input, {
        repeat: data.repeat === true,
      }),
    );
  });

export const runLinkEvidence = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: linkEvidenceInputSchema }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return attempt(() => LinkEvidenceService.run(scopeOf(context), data.input));
  });

export const runLinkRecovery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      input: linkRecoveryInputSchema,
      repeat: z.boolean().optional(),
    }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return attempt(() =>
      LinkDiscoveryService.runRecovery(scopeOf(context), data.input.kind, {
        repeat: data.repeat,
      }),
    );
  });

// Free: fetches only the pages the user names.
export const checkLinkMentions = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: linkMentionInputSchema }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return attempt(() =>
      LinkDiscoveryService.checkMentions(scopeOf(context), data.input),
    );
  });

// ---- Writes to stored data. ----

export const saveLinkQualificationSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ settings: qualificationSettingsSchema }))
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await LinkGapService.saveSettings(scopeOf(context), data.settings);
    return { ok: true as const };
  });

// ---- Prospects. Stored data only. ----

export const getLinkProspects = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ query: prospectListQuerySchema }))
  .handler(({ data, context }) =>
    LinkProspectService.list(context.projectId, data.query),
  );

export const getLinkProspect = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ id: z.string().min(1) }))
  .handler(({ data, context }) =>
    LinkProspectService.detail(context.projectId, data.id),
  );

export const getAiCitedLinkSources = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(({ context }) =>
    LinkProspectService.aiCitedSources(context.projectId),
  );

function managed<T>(
  context: Parameters<typeof scopeOf>[0] &
    Parameters<typeof requireOrgPermission>[0],
  fn: (ctx: LinkAcquisitionContext) => Promise<T>,
) {
  requireOrgPermission(context, { integration: ["manage"] });
  return attempt(() => fn(scopeOf(context)));
}

// A person did something to outreach or the do-not-contact list; the entry is
// written only after the change went through.
async function audited<T extends { ok: boolean }>(
  context: Parameters<typeof scopeOf>[0] & { userEmail: string },
  action:
    | "links.outreach_approved"
    | "links.outreach_sent"
    | "links.reply_logged"
    | "links.suppression_changed",
  summary: string,
  targetId: string,
  result: Promise<T>,
) {
  const value = await result;
  if (value.ok) {
    await AuditLogService.recordUser(context, action, summary, {
      projectId: context.projectId,
      targetKind: "link_outreach",
      targetId,
    });
  }
  return value;
}

export const saveLinkProspectsFromGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: saveFromGapInputSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) => LinkProspectService.saveFromGap(ctx, data.input)),
  );

export const saveLinkProspectsFromAi = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: saveFromAiInputSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) =>
      LinkProspectService.saveFromAiCitations(ctx, data.input),
    ),
  );

export const saveLinkProspectManually = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: saveManualInputSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) => LinkProspectService.saveManual(ctx, data.input)),
  );

export const updateLinkProspects = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: prospectUpdateInputSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) => LinkProspectService.update(ctx, data.input)),
  );

export const qualifyLinkProspects = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: prospectIdsSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) => LinkProspectService.qualify(ctx, data.input.ids)),
  );

export const matchLinkProspectAssets = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: prospectIdsSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) =>
      LinkProspectService.matchAssets(ctx, data.input.ids),
    ),
  );

export const createLinkAssetOpportunity = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: assetOpportunityInputSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) =>
      LinkProspectService.createAssetOpportunity(ctx, data.input),
    ),
  );

// ---- Outreach. Nothing here sends mail. ----

export const getLinkOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ prospectId: z.string().min(1).optional() }))
  .handler(async ({ data, context }) => ({
    drafts: await LinkOutreachService.list(context.projectId, data.prospectId),
    suppressions: await LinkOutreachService.listSuppressions(context.projectId),
  }));

export const generateLinkOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: outreachGenerateInputSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) => LinkOutreachService.generate(ctx, data.input)),
  );

export const editLinkOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: outreachEditInputSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) => LinkOutreachService.edit(ctx, data.input)),
  );

export const approveLinkOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: draftIdSchema }))
  .handler(({ data, context }) =>
    audited(
      context,
      "links.outreach_approved",
      "Approved an outreach draft",
      data.input.draftId,
      managed(context, (ctx) =>
        LinkOutreachService.approve(ctx, data.input.draftId),
      ),
    ),
  );

export const exportLinkOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: draftIdSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) =>
      LinkOutreachService.exportDraft(ctx, data.input.draftId),
    ),
  );

export const markLinkOutreachSent = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: draftIdSchema }))
  .handler(({ data, context }) =>
    audited(
      context,
      "links.outreach_sent",
      "Marked an outreach draft as sent",
      data.input.draftId,
      managed(context, (ctx) =>
        LinkOutreachService.markSent(ctx, data.input.draftId),
      ),
    ),
  );

export const logLinkOutreachReply = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: outreachReplyInputSchema }))
  .handler(({ data, context }) =>
    audited(
      context,
      "links.reply_logged",
      "Logged a reply to outreach",
      data.input.draftId,
      managed(context, (ctx) => LinkOutreachService.logReply(ctx, data.input)),
    ),
  );

export const withdrawLinkOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: draftIdSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) =>
      LinkOutreachService.withdraw(ctx, data.input.draftId),
    ),
  );

export const addLinkSuppression = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: suppressionInputSchema }))
  .handler(({ data, context }) =>
    audited(
      context,
      "links.suppression_changed",
      `Added ${data.input.value} to the do-not-contact list`,
      data.input.value,
      managed(context, (ctx) =>
        LinkOutreachService.addSuppression(ctx, data.input.value),
      ),
    ),
  );

export const removeLinkSuppression = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: suppressionInputSchema }))
  .handler(({ data, context }) =>
    audited(
      context,
      "links.suppression_changed",
      `Removed ${data.input.value} from the do-not-contact list`,
      data.input.value,
      managed(context, (ctx) =>
        LinkOutreachService.removeSuppression(ctx.projectId, data.input.value),
      ),
    ),
  );

// ---- Acquired links. Verification fetches the linking page only. ----

export const getLinkPlacements = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) => ({
    placements: await LinkVerificationService.list(context.projectId),
    report: await LinkReportService.report(context.projectId),
  }));

export const createLinkPlacement = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: placementCreateInputSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) => LinkVerificationService.create(ctx, data.input)),
  );

export const verifyLinkPlacement = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: placementIdSchema }))
  .handler(({ data, context }) =>
    managed(context, (ctx) =>
      LinkVerificationService.verify(ctx, data.input.placementId),
    ),
  );
