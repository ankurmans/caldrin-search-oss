import { createServerFn } from "@tanstack/react-start";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { draftBrandVoiceGuide } from "@/server/features/content/services/brandVoice";
import { ContentService } from "@/server/features/content/services/ContentService";
import { StorePlatformService } from "@/server/features/content/services/storePlatform";
import { ContentRefusal } from "@/server/features/content/rules/contentRefusal";
import { SHOPIFY_ACTIONS } from "@/server/features/content/rules/shopifyChange";
import { LedgerRefusal } from "@/server/features/ledger/types";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectScoped = z.object({ projectId: z.string().min(1) });
const assetScoped = projectScoped.extend({ assetId: z.string().min(1) });
const connectSchema = projectScoped.extend({
  shopDomain: z.string().min(3).max(120),
  accessToken: z.string().min(10).max(200),
});
const startOAuthSchema = projectScoped.extend({
  shop: z.string().min(3).max(120),
});
const briefSchema = projectScoped.extend({
  opportunityId: z.string().min(1),
  generator: z.enum(["template", "llm"]).default("template"),
});
// The admin address shows the bare number; the API wants the global id.
const articleGid = (id: string) =>
  /^\d+$/.test(id) ? `gid://shopify/Article/${id}` : id;
const actionSchema = z.enum(SHOPIFY_ACTIONS);
const previewSchema = assetScoped.extend({
  action: actionSchema.optional(),
  targetExternalId: z.string().min(1).max(200).optional(),
});
const entryScoped = projectScoped.extend({ entryId: z.string().min(1) });
const executeSchema = entryScoped.extend({
  confirmUpdate: z.boolean().optional(),
  targetExternalId: z.string().min(1).max(200).optional(),
  adoptExternalId: z.string().min(1).max(200).optional(),
});
const rollbackSchema = entryScoped.extend({
  overwriteLaterEdits: z.boolean().optional(),
  manuallyRestored: z.boolean().optional(),
});

const answersSchema = assetScoped.extend({
  answers: z
    .array(
      z.object({
        question: z.string().min(1).max(300),
        answer: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(20),
});

export type ContentResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

// Expected refusals (policy gates, Shopify rejections) become typed results the
// UI can show; the app's error middleware only forwards bare error codes.
async function run<T>(fn: () => Promise<T>): Promise<ContentResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ContentRefusal || error instanceof LedgerRefusal) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

function scopeOf(context: {
  projectId: string;
  organizationId: string;
  userId: string;
}) {
  return {
    projectId: context.projectId,
    organizationId: context.organizationId,
    userId: context.userId,
  };
}

export const getContentOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) => {
    const [connection, opportunities, assets, shopifyOAuthConfigured] =
      await Promise.all([
        ContentService.getConnectionSummary(context.projectId),
        ContentService.listOpportunities(context.projectId),
        ContentService.listAssets(context.projectId),
        ContentService.isShopifyOAuthConfigured(),
      ]);
    const assignedToMe = assets
      .filter(
        (asset) =>
          asset.reviewerUserId === context.userId && asset.status === "draft",
      )
      .map(({ id, title }) => ({ id, title }));
    return {
      connection,
      opportunities,
      assets,
      assignedToMe,
      shopifyOAuthConfigured,
    };
  });

// Whether this project looks like a Shopify store; the Shopify cards stay
// behind a collapsed link until it does.
export const getStorePlatform = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(({ context }) => StorePlatformService.getStatus(context.project));

export const recheckStorePlatform = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return StorePlatformService.recheck(context.project);
  });

export const setShopifyOverride = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ enabled: z.boolean() }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return StorePlatformService.setManualShopify(context.project, data.enabled);
  });

export const connectSimulatedShopify = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() => ContentService.connectSimulatedShop(scopeOf(context)));
  });

export const connectShopifyStore = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(connectSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await run(() =>
      ContentService.connectShopify(scopeOf(context), {
        shopDomain: data.shopDomain,
        accessToken: data.accessToken,
      }),
    );
    if (result.ok) {
      await AuditLogService.recordUser(
        context,
        "integration.connected",
        `Connected the Shopify store ${data.shopDomain}`,
        { projectId: context.projectId, targetKind: "shopify" },
      );
    }
    return result;
  });

export const disconnectShopifyStore = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    // `revoked` is false when Shopify did not confirm the revocation; the
    // local token is deleted either way. UNVERIFIED LIVE.
    const result = await ContentService.disconnectShopify(context.projectId);
    await AuditLogService.recordUser(
      context,
      "integration.disconnected",
      "Disconnected the Shopify store",
      { projectId: context.projectId, targetKind: "shopify" },
    );
    return result;
  });

export const startShopifyOAuth = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(startOAuthSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.startShopifyOAuth(scopeOf(context), {
        shop: data.shop,
        publicOrigin: getPublicOrigin(getRequest()),
      }),
    );
  });

export const extractContentOpportunities = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() => ContentService.extractOpportunities(scopeOf(context)));
  });

export const createContentDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(briefSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.createBriefAndDraft(
        scopeOf(context),
        data.opportunityId,
        data.generator,
      ),
    );
  });

export const draftBrandVoice = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() => draftBrandVoiceGuide(scopeOf(context)));
  });

export const answerDraftGaps = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(answersSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.answerPlaceholders(
        scopeOf(context),
        data.assetId,
        data.answers,
      ),
    );
  });

export const approveContentDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    assetScoped.extend({
      expectedRevision: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.approveDraft(
        scopeOf(context),
        data.assetId,
        data.expectedRevision,
      ),
    );
  });

export const createShopifyArticleDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(assetScoped)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.createShopifyDraft(scopeOf(context), data.assetId),
    );
  });

export const publishShopifyArticle = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(assetScoped)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await run(() =>
      ContentService.publishToShopify(scopeOf(context), data.assetId),
    );
    if (result.ok) {
      await AuditLogService.recordUser(
        context,
        "content.published",
        "Published an article to Shopify",
        {
          projectId: context.projectId,
          targetKind: "content_asset",
          targetId: data.assetId,
        },
      );
    }
    return result;
  });

export const getShopifyChangePreview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(previewSchema)
  .handler(async ({ data, context }) =>
    run(() =>
      ContentService.getProposedChange(scopeOf(context), data.assetId, {
        action: data.action,
        targetExternalId: data.targetExternalId,
      }),
    ),
  );

export const getShopifyChanges = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(assetScoped)
  .handler(async ({ data, context }) =>
    run(() =>
      ContentService.listShopifyChanges(context.projectId, data.assetId),
    ),
  );

export const getShopifyBlogs = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) =>
    run(() => ContentService.listShopifyBlogs(context.projectId)),
  );

export const setShopifyBlog = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ blogId: z.string().min(1).nullable() }))
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.setShopifyBlog(context.projectId, data.blogId),
    );
  });

export const setShopifyAutoPublish = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ enabled: z.boolean() }))
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await run(() =>
      ContentService.setShopifyAutoPublish(context.projectId, data.enabled),
    );
    if (result.ok) {
      await AuditLogService.recordUser(
        context,
        "integration.updated",
        data.enabled
          ? "Turned on auto-publish for the Shopify store"
          : "Turned off auto-publish for the Shopify store",
        { projectId: context.projectId, targetKind: "shopify" },
      );
    }
    return result;
  });

export const getShopifyArticles = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) =>
    run(() => ContentService.listShopifyArticles(context.projectId)),
  );

export const proposeShopifyChange = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    previewSchema.extend({
      expectedDestination: z
        .string()
        .regex(/^dest_[a-f0-9]{24}$/)
        .optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.proposeShopifyChange(scopeOf(context), data.assetId, {
        action: data.action,
        targetExternalId: data.targetExternalId,
        expectedDestination: data.expectedDestination,
      }),
    );
  });

export const approveShopifyChange = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(entryScoped)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.approveShopifyChange(scopeOf(context), data.entryId),
    );
  });

export const executeShopifyChange = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(executeSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.executeShopifyChange(scopeOf(context), data.entryId, {
        confirmUpdate: data.confirmUpdate,
        targetExternalId: data.targetExternalId,
        adoptExternalId:
          data.adoptExternalId && articleGid(data.adoptExternalId),
      }),
    );
  });

// Checks the store for a change stuck in "executing" (the Worker died mid-
// write). Reads only; never re-issues the write.
export const reconcileShopifyChange = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(entryScoped)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.reconcileShopifyChange(context.projectId, data.entryId),
    );
  });

// After a store check could not settle a stuck change, a person confirms the
// write is not in the store. Records a failure; Shopify is not called.
export const markShopifyChangeNotApplied = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(entryScoped)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.markShopifyChangeNotApplied(
        scopeOf(context),
        data.entryId,
      ),
    );
  });

export const rollbackShopifyChange = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(rollbackSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      ContentService.rollbackShopifyChange(scopeOf(context), data.entryId, {
        overwriteLaterEdits: data.overwriteLaterEdits,
        manuallyRestored: data.manuallyRestored,
      }),
    );
  });
