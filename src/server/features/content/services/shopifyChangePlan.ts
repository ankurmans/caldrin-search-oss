import { sortBy } from "remeda";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import type {
  LedgerEntry,
  LedgerEntryWithNames,
} from "@/server/features/ledger/types";
import { AppError } from "@/server/lib/errors";
import { ContentRepository } from "../repositories/ContentRepository";
import type { ContentAsset } from "../repositories/ContentRepository";
import { diffArticles, renderArticleState } from "../rules/articleDiff";
import type { ArticleDiff, ArticleState } from "../rules/articleDiff";
import { ContentRefusal } from "../rules/contentRefusal";
import { actionFromKey, idempotencyKey } from "../rules/publishPolicy";
import { hasBlockingFailure } from "../rules/qualityChecks";
import type { QualityCheck } from "../rules/qualityChecks";
import {
  ACTION_PLAN,
  proposedActionText,
  shortHash,
} from "../rules/shopifyChange";
import type { ShopifyAction } from "../rules/shopifyChange";
import { SHOPIFY_ADAPTER_VERIFIED } from "../shopify/liveShopify";
import type { StoreArticleDetail } from "../shopify/ShopifyStorePort";
import { requireConnection, storeFor } from "./shopifyConnection";
import {
  draftDestinationStamp,
  shopifyDraftDestination,
  verifyDraftDestination,
} from "./shopifyDraftDestination";
import { findCreatedArticle } from "./shopifyVerification";
import type { Scope } from "./shopifyConnection";

// What will change, shown before anything is written, and the ledger proposal
// built from exactly the same data.

type ProposedChange = {
  action: ShopifyAction;
  assetId: string;
  revision: number;
  title: string;
  // The article as it is in Shopify now. null when a new article is created.
  before: StoreArticleDetail | null;
  after: ArticleState & { isPublished: boolean };
  diff: ArticleDiff;
  checks: QualityCheck[];
  blocked: boolean;
  linkedProducts: { handle: string; title: string; available: boolean }[];
  linkedCollections: { handle: string; title: string }[];
  // The text this changes goes (or already is) public.
  goesPublic: boolean;
  // An update replaces an existing article's text and must be confirmed.
  requiresConfirmUpdate: boolean;
  opportunityId: string | null;
  mode: "live" | "simulated";
  isDevelopmentStore: boolean;
  adapterVerified: "mock" | "live";
  draftDestination: Awaited<ReturnType<typeof shopifyDraftDestination>> | null;
};

type ProposeInput = {
  action?: ShopifyAction;
  targetExternalId?: string;
  expectedDestination?: string;
};

async function loadAsset(projectId: string, assetId: string) {
  const asset = await ContentRepository.getAsset(projectId, assetId);
  if (!asset) throw new AppError("NOT_FOUND", "Draft not found.");
  if (await ContentRepository.isClaimCorrectionDraft(asset))
    throw new ContentRefusal(
      "Apply this correction to the affected passage on the target site. A correction snippet cannot replace an article.",
    );
  return asset;
}

function assetFields(asset: ContentAsset) {
  return {
    title: asset.title,
    bodyHtml: asset.bodyHtml,
    metaTitle: asset.metaTitle,
    metaDescription: asset.metaDescription,
  };
}

function assertNoBlockingChecks(checks: QualityCheck[]): void {
  if (checks.length === 0) {
    throw new ContentRefusal("Quality checks have not run for this revision.");
  }
  if (hasBlockingFailure(checks)) {
    const failed = checks
      .filter((c) => c.severity === "block" && !c.passed)
      .map((c) => c.key)
      .join(", ");
    throw new ContentRefusal(`Blocking quality checks failed: ${failed}.`);
  }
}

// Reads Shopify (never writes) to build the before side.
async function loadBefore(
  scope: Pick<Scope, "projectId">,
  asset: ContentAsset,
  action: ShopifyAction,
  targetExternalId: string | undefined,
  connection: Awaited<ReturnType<typeof requireConnection>>,
): Promise<StoreArticleDetail | null> {
  if (action === "create_draft") return null;
  const store = await storeFor(connection);
  let externalId = targetExternalId;
  if (action === "publish_draft") {
    const created = await findCreatedArticle(asset.id, asset.revision);
    if (!created?.externalId) {
      throw new ContentRefusal(
        "Create the Shopify draft for this revision before publishing it.",
      );
    }
    externalId = created.externalId;
  }
  if (!externalId) {
    throw new ContentRefusal("Choose the Shopify article to update.");
  }
  const article = await store.getArticle(externalId);
  if (!article) {
    throw new ContentRefusal("That article no longer exists in the store.");
  }
  if (action === "publish_draft" && article.isPublished) {
    throw new ContentRefusal("That article is already published.");
  }
  return article;
}

export async function getProposedChange(
  scope: Pick<Scope, "projectId">,
  assetId: string,
  input: ProposeInput = {},
): Promise<ProposedChange> {
  const asset = await loadAsset(scope.projectId, assetId);
  const connection = await requireConnection(scope.projectId);
  const action =
    input.action ??
    (input.targetExternalId ? "update_existing" : "create_draft");
  const before = await loadBefore(
    scope,
    asset,
    action,
    input.targetExternalId,
    connection,
  );

  const fields =
    action === "publish_draft" && before ? before : assetFields(asset);
  const after = {
    title: fields.title,
    bodyHtml: fields.bodyHtml,
    metaTitle: fields.metaTitle,
    metaDescription: fields.metaDescription,
    isPublished:
      action === "publish_draft" ? true : (before?.isPublished ?? false),
  };
  const [checks, references, draftDestination] = await Promise.all([
    ContentRepository.listQualityChecks(asset.id, asset.revision),
    ContentRepository.listReferences(asset.id),
    action === "create_draft"
      ? storeFor(connection).then((store) =>
          shopifyDraftDestination(connection, store),
        )
      : null,
  ]);
  return {
    action,
    assetId: asset.id,
    revision: asset.revision,
    title: asset.title,
    before,
    after,
    diff: diffArticles(before, after),
    checks,
    blocked: hasBlockingFailure(checks),
    linkedProducts: references
      .filter((r) => r.refType === "product")
      .map((r) => ({
        handle: r.handle,
        title: r.title,
        available: r.available,
      })),
    linkedCollections: references
      .filter((r) => r.refType === "collection")
      .map((r) => ({ handle: r.handle, title: r.title })),
    goesPublic: action === "publish_draft" || after.isPublished,
    requiresConfirmUpdate: action === "update_existing",
    opportunityId: asset.opportunityId,
    mode: connection.mode,
    isDevelopmentStore: connection.isDevelopmentStore,
    adapterVerified: SHOPIFY_ADAPTER_VERIFIED,
    draftDestination,
  };
}

// The numbers the opportunity was found with, used only when the opportunity
// engine stored no evidence rows of its own. Labeled by its real source.
async function fallbackEvidence(projectId: string, opportunityId: string) {
  if (
    await ContentRepository.hasOpportunityEvidence(projectId, opportunityId)
  ) {
    return [];
  }
  const opportunity = await ContentRepository.getOpportunity(
    projectId,
    opportunityId,
  );
  if (!opportunity) return [];
  return [
    {
      source: opportunity.dataSource,
      label: "Search numbers when the opportunity was found",
      value: `"${opportunity.query}": ${opportunity.impressions} impressions, ${opportunity.clicks} clicks, position ${opportunity.position.toFixed(1)} (${opportunity.windowStart} to ${opportunity.windowEnd})`,
      url: opportunity.pageUrl,
      observedAt: opportunity.windowEnd,
    },
  ];
}

// The same proposal twice is one change. A rejected change is finished, so
// proposing it again starts a new attempt (`:2`, ...). A create that already
// made an article is never repeated: the article is there to publish, or the
// draft is edited to start a new revision.
async function freeKey(
  projectId: string,
  assetId: string,
  base: string,
): Promise<string> {
  const entries = await listShopifyChanges(projectId, assetId);
  for (let attempt = 1; ; attempt++) {
    const candidate = attempt === 1 ? base : `${base}:${attempt}`;
    const found = entries.find((e) => e.idempotencyKey === candidate);
    if (
      found?.status === "rolled_back" &&
      actionFromKey(base) === "create_draft"
    )
      throw new ContentRefusal(
        "This revision's Shopify draft was created and then rolled back. Edit the draft to start a new attempt.",
      );
    if (!found || found.status !== "rejected") return candidate;
  }
}

export async function proposeShopifyChange(
  scope: Scope,
  assetId: string,
  input: ProposeInput = {},
): Promise<{ entry: LedgerEntry; proposed: ProposedChange }> {
  const connection = await requireConnection(scope.projectId);
  if (!connection.canPublish) {
    throw new ContentRefusal(
      "This connection is read-only. Reconnect with write_content to change the store.",
    );
  }
  const proposed = await getProposedChange(scope, assetId, input);
  assertNoBlockingChecks(proposed.checks);
  if (
    input.expectedDestination &&
    input.expectedDestination !== proposed.draftDestination?.stamp
  )
    throw new ContentRefusal(
      "The draft destination changed. Reload the preview before proposing.",
    );
  if (proposed.action === "update_existing" && proposed.diff.unchanged) {
    throw new ContentRefusal("The article already has exactly this text.");
  }

  const plan = ACTION_PLAN[proposed.action];
  const targetId = proposed.before?.externalId;
  const beforeState = proposed.before
    ? renderArticleState(proposed.before, targetId)
    : (proposed.draftDestination?.record ?? null);
  const afterState = renderArticleState(proposed.after, targetId);
  const key = await freeKey(
    scope.projectId,
    proposed.assetId,
    idempotencyKey(
      proposed.assetId,
      proposed.revision,
      plan.keyAction,
      proposed.action === "create_draft"
        ? undefined
        : shortHash(`${beforeState}\n${afterState}`),
    ),
  );

  const entry = await LedgerService.proposeChange(scope, {
    kind: plan.kind,
    provider: "shopify",
    proposedAction: proposedActionText(proposed.action, proposed.title),
    opportunityId: proposed.opportunityId,
    contentAssetId: proposed.assetId,
    contentRevision: proposed.revision,
    targetUrl: proposed.before?.url ?? null,
    beforeState,
    afterState,
    rollbackKind:
      proposed.action === "update_existing"
        ? "restore_previous_content"
        : "unpublish",
    measurementMetric: "gsc_clicks",
    measurementWindowDays: 28,
    evidence: proposed.opportunityId
      ? await fallbackEvidence(scope.projectId, proposed.opportunityId)
      : [],
    idempotencyKey: key,
  });
  if (
    proposed.draftDestination &&
    draftDestinationStamp(entry.beforeState) !== proposed.draftDestination.stamp
  )
    throw new ContentRefusal(
      "This revision already has a Shopify proposal for a different or unrecorded destination. Save a new revision to propose it for this destination.",
    );
  return { entry, proposed };
}

// A person approves one change. Approval is bound to the asset revision by the
// ledger; the asset's own approval is kept in step so both agree.
export async function approveShopifyChange(
  scope: Scope,
  entryId: string,
): Promise<LedgerEntry> {
  const { entry } = await LedgerService.getEntry(scope.projectId, entryId);
  if (
    entry.provider !== "shopify" ||
    !entry.contentAssetId ||
    entry.contentRevision === null
  ) {
    throw new ContentRefusal("This is not a Shopify content change.");
  }
  const asset = await loadAsset(scope.projectId, entry.contentAssetId);
  if (asset.revision !== entry.contentRevision) {
    throw new ContentRefusal(
      "The draft changed after this change was proposed. Propose it again.",
    );
  }
  const stamp = draftDestinationStamp(entry.beforeState);
  if (stamp) {
    const connection = await requireConnection(scope.projectId);
    await verifyDraftDestination(stamp, connection, await storeFor(connection));
  }
  const checks = await ContentRepository.listQualityChecks(
    asset.id,
    asset.revision,
  );
  assertNoBlockingChecks(checks);
  if (asset.approvedRevision !== asset.revision) {
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
  }
  return LedgerService.approveChange(scope, entryId);
}

export async function listShopifyChanges(
  projectId: string,
  assetId: string,
): Promise<LedgerEntryWithNames[]> {
  const [created, updated] = await Promise.all([
    LedgerService.listEntriesWithNames(projectId, {
      kind: "content_article_create",
      limit: 200,
    }),
    LedgerService.listEntriesWithNames(projectId, {
      kind: "content_article_update",
      limit: 200,
    }),
  ]);
  return sortBy(
    [...created, ...updated].filter((e) => e.contentAssetId === assetId),
    [(e) => e.createdAt, "desc"],
  );
}
