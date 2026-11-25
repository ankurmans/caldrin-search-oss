import { editDraft, getAssetDetail } from "./editorialDrafts";
import { AppError } from "@/server/lib/errors";
import { OpportunityEngineService } from "@/server/features/opportunities/services/OpportunityEngineService";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { ContentRefusal } from "../rules/contentRefusal";
import { sanitizeHtml } from "../rules/sanitizeHtml";
import { ContentRepository } from "../repositories/ContentRepository";
import { buildBrief } from "../rules/briefBuilder";
import {
  FACTS_SECTION_SLUG,
  fillPlaceholders,
  findPlaceholders,
  mergeFacts,
  type PlaceholderAnswer,
} from "../rules/placeholders";
import { actionFromKey, canApprove } from "../rules/publishPolicy";
import { runQualityChecks } from "../rules/qualityChecks";
import { buildTemplateDraft } from "../rules/templateDraft";
import {
  generateLlmDraft,
  MAX_LLM_DRAFTS_PER_PROJECT_PER_DAY,
} from "./llmDraft";
import {
  connectShopify,
  connectSimulatedShop,
  disconnectShopify,
  getConnectionSummary,
  requireConnection,
  setAutoPublish,
  storeFor,
  storeForProject,
} from "./shopifyConnection";
import type { Scope } from "./shopifyConnection";
import { executeShopifyChange } from "./shopifyExecution";
import {
  approveShopifyChange,
  getProposedChange,
  listShopifyChanges,
  proposeShopifyChange,
} from "./shopifyChangePlan";
import {
  isShopifyOAuthConfigured,
  startShopifyOAuth,
} from "./shopifyOAuthFlow";
import {
  markShopifyChangeNotApplied,
  reconcileShopifyChange,
} from "./shopifyReconcile";
import { rollbackShopifyChange } from "./shopifyRollback";

// The opportunity engine reads Search Console, the store, and stored audits,
// and stores every opportunity with its evidence. Nothing paid runs here.
async function extractOpportunities(scope: Scope) {
  await OpportunityEngineService.run(scope);
  return ContentRepository.listOpportunities(scope.projectId);
}

async function createBriefAndDraft(
  scope: Scope,
  opportunityId: string,
  generator: "template" | "llm" = "template",
) {
  const opportunity = await ContentRepository.getOpportunity(
    scope.projectId,
    opportunityId,
  );
  if (!opportunity) throw new AppError("NOT_FOUND", "Opportunity not found.");
  if (opportunity.recommendedAction === "no_action") {
    throw new ContentRefusal(
      "This opportunity's recommended action is no action, so no draft was created.",
    );
  }
  const connection = await requireConnection(scope.projectId);
  const store = await (await storeFor(connection)).readSnapshot();
  const brief = buildBrief(
    {
      query: opportunity.query,
      pageUrl: opportunity.pageUrl ?? "",
      clicks: opportunity.clicks,
      impressions: opportunity.impressions,
      ctr: opportunity.ctr,
      position: opportunity.position,
      action: opportunity.recommendedAction,
      reason: opportunity.reason,
      matchedCollectionHandle: opportunity.matchedCollectionHandle,
    },
    store,
  );
  let draft = buildTemplateDraft(brief, store);
  let costUsd = 0;
  if (generator === "llm") {
    const used = await ContentRepository.countCostsSince(
      scope.projectId,
      "llm_draft",
      new Date().toISOString().slice(0, 10),
    );
    if (used >= MAX_LLM_DRAFTS_PER_PROJECT_PER_DAY) {
      throw new ContentRefusal(
        `This project reached ${MAX_LLM_DRAFTS_PER_PROJECT_PER_DAY} AI drafts today. Edit an existing draft or try tomorrow (UTC).`,
      );
    }
    const estimate = SpendService.estimateLlmDraftUsd();
    await SpendService.assertWithinLimits(scope, {
      estimatedUsd: estimate.estimatedUsd,
      provider: "llm",
      operation: "llm_draft",
    });
    ({ draft, costUsd } = await generateLlmDraft(
      brief,
      store,
      await ProjectContextService.getProjectContext(scope.projectId),
    ));
    await SpendService.recordCost(scope, {
      provider: "llm",
      operation: "llm_draft",
      estimatedUsd: estimate.estimatedUsd,
      costUsd,
    });
  }
  draft = { ...draft, bodyHtml: sanitizeHtml(draft.bodyHtml) };
  const asset = await ContentRepository.createAsset({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    opportunityId: opportunity.id,
    title: draft.title,
    searchIntent: brief.searchIntent,
    briefMarkdown: brief.markdown,
    bodyHtml: draft.bodyHtml,
    metaTitle: draft.metaTitle,
    metaDescription: draft.metaDescription,
    generator,
    createdByUserId: scope.userId,
    references: [
      ...brief.products.map((p) => ({
        refType: "product" as const,
        handle: p.handle,
        title: p.title,
        available: p.available,
      })),
      ...brief.collectionHandles.flatMap((handle) => {
        const c = store.collections.find((x) => x.handle === handle);
        return c
          ? [
              {
                refType: "collection" as const,
                handle,
                title: c.title,
                available: true,
              },
            ]
          : [];
      }),
    ],
  });
  await ContentRepository.replaceQualityChecks(
    asset.id,
    asset.revision,
    runQualityChecks(draft, store),
  );
  if (generator === "llm") {
    await ContentRepository.logCost({
      projectId: scope.projectId,
      assetId: asset.id,
      provider: "llm",
      operation: "llm_draft",
      costUsd,
    });
  }
  await ContentRepository.setOpportunityStatus(
    scope.projectId,
    opportunity.id,
    "briefed",
  );
  return getAssetDetail(scope.projectId, asset.id);
}

// Fills the draft's gaps with the merchant's answers, saves the draft as a new
// revision, and remembers the answers on the Context page so later drafts use
// them instead of asking again.
async function answerPlaceholders(
  scope: Scope,
  assetId: string,
  answers: PlaceholderAnswer[],
) {
  const asset = await ContentRepository.getAsset(scope.projectId, assetId);
  if (!asset) throw new AppError("NOT_FOUND", "Draft not found.");
  const open = new Set(findPlaceholders(asset.bodyHtml));
  const given = answers.filter(
    (a) => open.has(a.question) && a.answer.trim().length > 0,
  );
  if (given.length === 0) {
    throw new ContentRefusal("None of the answers match a gap in this draft.");
  }
  const detail = await editDraft(
    scope,
    assetId,
    {
      title: asset.title,
      bodyHtml: fillPlaceholders(asset.bodyHtml, given),
      metaTitle: asset.metaTitle,
      metaDescription: asset.metaDescription,
    },
    asset.revision,
  );
  const context = await ProjectContextService.getProjectContext(
    scope.projectId,
  );
  const existing =
    context.customSections.find((s) => s.slug === FACTS_SECTION_SLUG)
      ?.content ?? "";
  await ProjectContextService.applyContextUpdates(
    scope.projectId,
    [
      {
        customSection: FACTS_SECTION_SLUG,
        title: "Merchant facts",
        content: mergeFacts(existing, given),
      },
    ],
    "user",
  );
  return detail;
}

async function approveDraft(
  scope: Scope,
  assetId: string,
  expectedRevision?: number,
) {
  const asset = await ContentRepository.getAsset(scope.projectId, assetId);
  if (!asset) throw new AppError("NOT_FOUND", "Draft not found.");
  if (expectedRevision !== undefined && asset.revision !== expectedRevision)
    throw new ContentRefusal("Review the latest revision before approving.");
  const checks = await ContentRepository.listQualityChecks(
    asset.id,
    asset.revision,
  );
  const verdict = canApprove(asset, checks);
  if (!verdict.ok) throw new ContentRefusal(verdict.reason);
  const ok = await ContentRepository.approveAsset(
    scope.projectId,
    asset.id,
    asset.revision,
    scope.userId,
  );
  if (!ok) {
    throw new ContentRefusal(
      "The draft changed while approving. Review it again.",
    );
  }
  if (await ContentRepository.isClaimCorrectionDraft(asset))
    return getAssetDetail(scope.projectId, assetId);
  // Approving the draft is also the person's approval to create it in Shopify
  // as an unpublished draft: record that as a ledger change for this revision.
  const connection = await ContentRepository.getConnection(scope.projectId);
  if (connection?.canPublish) {
    await ensureCreateApproved(scope, asset.id);
    if (connection.autoPublish && connection.mode === "live") {
      await autoPublishDraft(scope, asset.id);
    }
  }
  return getAssetDetail(scope.projectId, assetId);
}

// Only reached when a person turned auto-publish on for this store. It takes
// the same ledger steps as a manual publish, so every one is recorded.
async function autoPublishDraft(scope: Scope, assetId: string) {
  await createShopifyDraft(scope, assetId);
  const { entry } = await proposeShopifyChange(scope, assetId, {
    action: "publish_draft",
  });
  if (entry.status === "executed") return;
  const approved =
    entry.status === "proposed" || entry.status === "failed"
      ? await approveShopifyChange(scope, entry.id)
      : entry;
  await executeShopifyChange(scope, approved.id);
}

// The legacy per-asset buttons. Both run through the ledger: nothing reaches
// Shopify unless a ledger entry for this exact revision is approved.
async function ensureCreateApproved(scope: Scope, assetId: string) {
  const asset = await ContentRepository.getAsset(scope.projectId, assetId);
  if (!asset) throw new AppError("NOT_FOUND", "Draft not found.");
  if (asset.approvedRevision !== asset.revision) {
    throw new ContentRefusal("The current revision has not been approved.");
  }
  const { entry } = await proposeShopifyChange(scope, asset.id, {
    action: "create_draft",
  });
  if (entry.status === "proposed" || entry.status === "failed") {
    return approveShopifyChange(scope, entry.id);
  }
  return entry;
}

async function createShopifyDraft(scope: Scope, assetId: string) {
  const entry = await ensureCreateApproved(scope, assetId);
  if (entry.status !== "executed") {
    await executeShopifyChange(scope, entry.id);
  }
  return getAssetDetail(scope.projectId, assetId);
}

async function publishToShopify(scope: Scope, assetId: string) {
  const changes = await listShopifyChanges(scope.projectId, assetId);
  const asset = await ContentRepository.getAsset(scope.projectId, assetId);
  if (!asset) throw new AppError("NOT_FOUND", "Draft not found.");
  const latest = changes.find(
    (e) =>
      e.contentRevision === asset.revision &&
      actionFromKey(e.idempotencyKey ?? "") === "publish",
  );
  if (!latest) {
    // Publishing makes the article public, so it is its own approval. Record
    // the proposal so the app can show what will change, then stop.
    await proposeShopifyChange(scope, assetId, { action: "publish_draft" });
    throw new ContentRefusal(
      "Publishing is a separate approval. Review what will change, then approve the publish.",
    );
  }
  if (latest.status === "executed")
    return getAssetDetail(scope.projectId, assetId);
  if (latest.status !== "approved") {
    throw new ContentRefusal(
      latest.status === "failed"
        ? "The last publish attempt failed. Approve the publish again to retry."
        : "Approve the publish change first.",
    );
  }
  await executeShopifyChange(scope, latest.id);
  return getAssetDetail(scope.projectId, assetId);
}

async function listShopifyBlogs(projectId: string) {
  return (await storeForProject(projectId)).listBlogs();
}

// null puts new articles back in the default blog.
async function setShopifyBlog(projectId: string, blogId: string | null) {
  if (blogId) {
    const blogs = await listShopifyBlogs(projectId);
    if (!blogs.some((blog) => blog.id === blogId)) {
      throw new ContentRefusal("That blog is not in the store.");
    }
  }
  await ContentRepository.setBlog(projectId, blogId);
}

async function listShopifyArticles(projectId: string) {
  return (await storeForProject(projectId)).listArticles();
}

export const ContentService = {
  getConnectionSummary,
  connectShopify,
  connectSimulatedShop,
  disconnectShopify,
  extractOpportunities,
  listOpportunities: ContentRepository.listOpportunities,
  createBriefAndDraft,
  listAssets: ContentRepository.listAssets,
  getAssetDetail,
  editDraft,
  answerPlaceholders,
  approveDraft,
  createShopifyDraft,
  publishToShopify,
  listShopifyArticles,
  listShopifyBlogs,
  setShopifyBlog,
  setShopifyAutoPublish: setAutoPublish,
  getProposedChange,
  proposeShopifyChange,
  approveShopifyChange,
  listShopifyChanges,
  executeShopifyChange,
  rollbackShopifyChange,
  reconcileShopifyChange,
  markShopifyChangeNotApplied,
  isShopifyOAuthConfigured,
  startShopifyOAuth,
};
