import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import type { LedgerEntry } from "@/server/features/ledger/types";
import { AppError } from "@/server/lib/errors";
import { ContentRepository } from "../repositories/ContentRepository";
import type { ContentAsset } from "../repositories/ContentRepository";
import type { ContentPublication } from "../repositories/PublicationRepository";
import { diffArticles, renderArticleState } from "../rules/articleDiff";
import { ContentRefusal } from "../rules/contentRefusal";
import { UNKNOWN_OUTCOME_PREFIX } from "../rules/shopifyReconcileRules";
import { actionFromKey, canCreateShopifyDraft } from "../rules/publishPolicy";
import {
  ACTION_PLAN,
  planUnpublishRollback,
  planUpdateRollback,
  shopifyActionFromKeyAction,
} from "../rules/shopifyChange";
import type { PlannedRollback, ShopifyAction } from "../rules/shopifyChange";
import { ShopifyOutcomeUnknown } from "../shopify/shopifyGraphql";
import type { ShopifyStorePort } from "../shopify/ShopifyStorePort";
import { requireConnection } from "./shopifyConnection";
import {
  draftDestinationStamp,
  storeForDraftDestination,
} from "./shopifyDraftDestination";
import {
  adopt,
  findCreatedArticle,
  readBack,
  requireFreshQualityChecks,
} from "./shopifyVerification";
import type { Scope } from "./shopifyConnection";

// Executes ONE approved ledger entry against Shopify. Every write below happens
// after LedgerService.beginExecution succeeded for that entry, and only then;
// beginExecution is the approval choke point (approved by a person, for the
// current content revision, not already executing).

type ExecuteInput = {
  // Required for an update of an existing article.
  confirmUpdate?: boolean;
  targetExternalId?: string;
  // After a create whose outcome Shopify never confirmed: the article the
  // person found in the store's blog, to use instead of creating another.
  adoptExternalId?: string;
};

type ExecutionResult = {
  entry: LedgerEntry;
  externalId: string;
  url: string;
};

type Context = {
  entry: LedgerEntry;
  asset: ContentAsset;
  action: ShopifyAction;
  mode: "live" | "simulated";
  blogId: string | null;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
}

async function loadContext(scope: Scope, entryId: string): Promise<Context> {
  const { entry } = await LedgerService.getEntry(scope.projectId, entryId);
  const keyAction = actionFromKey(entry.idempotencyKey ?? "");
  if (
    entry.provider !== "shopify" ||
    !keyAction ||
    !entry.contentAssetId ||
    entry.contentRevision === null
  ) {
    throw new ContentRefusal("This is not a Shopify content change.");
  }
  const action = shopifyActionFromKeyAction(keyAction);
  if (ACTION_PLAN[action].kind !== entry.kind) {
    throw new ContentRefusal("This change record is inconsistent.");
  }
  const asset = await ContentRepository.getAsset(
    scope.projectId,
    entry.contentAssetId,
  );
  if (!asset) throw new AppError("NOT_FOUND", "Draft not found.");
  if (asset.revision !== entry.contentRevision) {
    throw new ContentRefusal(
      "The draft changed after this change was approved. Propose it again.",
    );
  }
  const connection = await requireConnection(scope.projectId);
  const verdict = canCreateShopifyDraft(asset, connection);
  if (!verdict.ok) throw new ContentRefusal(verdict.reason);
  return {
    entry,
    asset,
    action,
    mode: connection.mode,
    blogId: connection.blogId,
  };
}

// Shopify may have created the article even though we never saw the answer.
function isAmbiguous(publication: ContentPublication): boolean {
  if (publication.externalId) return false;
  return (
    publication.state === "pending" ||
    (publication.error ?? "").startsWith(UNKNOWN_OUTCOME_PREFIX)
  );
}

// `fresh` is true when this call created the row, so an earlier attempt's
// leftovers can be told apart from our own just-made claim.
async function claim(
  ctx: Context,
  scope: Scope,
  key: string,
): Promise<{ publication: ContentPublication; fresh: boolean }> {
  const existing = await ContentRepository.findPublication(key);
  if (existing) return { publication: existing, fresh: false };
  const claimed = await ContentRepository.claimPublication({
    assetId: ctx.asset.id,
    revision: ctx.asset.revision,
    mode: ctx.mode,
    idempotencyKey: key,
    requestedByUserId: scope.userId,
  });
  if (!claimed) {
    throw new ContentRefusal("Another request is already running this change.");
  }
  return { publication: claimed, fresh: true };
}

async function failPublication(
  publication: ContentPublication,
  error: unknown,
): Promise<void> {
  const prefix =
    error instanceof ShopifyOutcomeUnknown ? UNKNOWN_OUTCOME_PREFIX : "";
  await ContentRepository.updatePublication(publication.id, {
    state: "failed",
    error: `${prefix}${messageOf(error)}`.slice(0, 500),
  });
}

async function createDraft(
  scope: Scope,
  ctx: Context,
  store: ShopifyStorePort,
  input: ExecuteInput,
) {
  const key = ctx.entry.idempotencyKey ?? "";
  const stamp = draftDestinationStamp(ctx.entry.beforeState);
  const earlier = await ContentRepository.findPublication(key);
  if (
    input.adoptExternalId &&
    !(earlier && !earlier.externalId && isAmbiguous(earlier))
  ) {
    throw new ContentRefusal(
      "There is nothing to adopt: no earlier attempt is waiting on an answer from Shopify.",
    );
  }
  const { publication, fresh } = await claim(ctx, scope, key);
  let externalId = publication.externalId;
  let url = publication.externalUrl ?? "";
  if (!externalId) {
    if (!fresh && isAmbiguous(publication)) {
      if (!input.adoptExternalId) {
        throw new ContentRefusal(
          "An earlier attempt to create this article did not confirm whether Shopify made it. Find it in the store's blog and adopt it here, or edit the draft to start a new attempt.",
        );
      }
      const found = await adopt(ctx.asset, store, input.adoptExternalId);
      if (stamp && found.blogId !== ctx.blogId)
        throw new ContentRefusal("Choose an article in the approved blog.");
      await ContentRepository.updatePublication(publication.id, {
        state: "draft_created",
        externalId: found.externalId,
        externalUrl: found.url,
        error: null,
      });
      externalId = found.externalId;
      url = found.url;
    }
  }
  if (!externalId) {
    try {
      const created = await store.createDraftArticle(
        {
          authorName: await store.readShopName(),
          title: ctx.asset.title,
          bodyHtml: ctx.asset.bodyHtml,
          metaTitle: ctx.asset.metaTitle,
          metaDescription: ctx.asset.metaDescription,
          blogId: ctx.blogId ?? undefined,
        },
        key,
      );
      await readBack(
        store,
        created.externalId,
        (a) =>
          !a.isPublished &&
          a.title === ctx.asset.title &&
          (!stamp || a.blogId === ctx.blogId),
        "The new draft",
      );
      externalId = created.externalId;
      url = created.url;
    } catch (error) {
      await failPublication(publication, error);
      throw error;
    }
    await ContentRepository.updatePublication(publication.id, {
      state: "draft_created",
      externalId,
      externalUrl: url,
      error: null,
    });
  }
  const after = {
    title: ctx.asset.title,
    bodyHtml: ctx.asset.bodyHtml,
    metaTitle: ctx.asset.metaTitle,
    metaDescription: ctx.asset.metaDescription,
    isPublished: false,
  };
  return {
    externalId,
    url,
    record: {
      externalId,
      targetUrl: url,
      publicationStatus: "draft" as const,
      diff: diffArticles(null, after).text,
      afterState: renderArticleState(after, externalId),
      rollback: planUnpublishRollback(externalId),
    },
  };
}

// The live article must still be what the person saw when they approved.
async function requireUnchanged(
  store: ShopifyStorePort,
  externalId: string,
  frozenBefore: string | null,
) {
  const current = await store.getArticle(externalId);
  if (!current) {
    throw new ContentRefusal("That article no longer exists in the store.");
  }
  if (renderArticleState(current, externalId) !== frozenBefore) {
    throw new ContentRefusal(
      "The article changed in Shopify after this change was proposed. Nothing was written. Propose the change again to review the new difference.",
    );
  }
  return current;
}

async function updateExisting(
  scope: Scope,
  ctx: Context,
  store: ShopifyStorePort,
  input: ExecuteInput,
) {
  const externalId = input.targetExternalId ?? "";
  const current = await requireUnchanged(
    store,
    externalId,
    ctx.entry.beforeState,
  );
  const { publication } = await claim(
    ctx,
    scope,
    ctx.entry.idempotencyKey ?? "",
  );
  const fields = {
    title: ctx.asset.title,
    bodyHtml: ctx.asset.bodyHtml,
    metaTitle: ctx.asset.metaTitle,
    metaDescription: ctx.asset.metaDescription,
  };
  const rollback: PlannedRollback = planUpdateRollback(current, fields);
  let updated;
  try {
    updated = await store.updateArticle(externalId, fields);
  } catch (error) {
    await failPublication(publication, error);
    throw error;
  }
  await ContentRepository.updatePublication(publication.id, {
    state: updated.isPublished ? "published" : "draft_created",
    externalId,
    externalUrl: updated.url,
    publishedAt: updated.isPublished ? new Date().toISOString() : undefined,
    error: null,
  });
  if (updated.isPublished) {
    await ContentRepository.setAssetStatus(
      scope.projectId,
      ctx.asset.id,
      "published",
    );
  }
  return {
    externalId,
    url: updated.url,
    record: {
      externalId,
      targetUrl: updated.url,
      publicationStatus: updated.isPublished
        ? ("published" as const)
        : ("draft" as const),
      // What was applied, read back from Shopify's own answer.
      diff: diffArticles(current, updated).text,
      afterState: renderArticleState(updated, externalId),
      rollback,
    },
  };
}

async function publishDraft(
  scope: Scope,
  ctx: Context,
  store: ShopifyStorePort,
) {
  const created = await findCreatedArticle(ctx.asset.id, ctx.asset.revision);
  if (!created?.externalId) {
    throw new ContentRefusal(
      "Create the Shopify draft for this revision before publishing it.",
    );
  }
  const externalId = created.externalId;
  const key = ctx.entry.idempotencyKey ?? "";
  const { publication } = await claim(ctx, scope, key);
  const current = await store.getArticle(externalId);
  if (!current) {
    throw new ContentRefusal("That article no longer exists in the store.");
  }
  // Already public (a retry after a lost answer): nothing to write.
  let url = current.url;
  if (!current.isPublished) {
    if (renderArticleState(current, externalId) !== ctx.entry.beforeState) {
      throw new ContentRefusal(
        "The draft changed in Shopify after this change was proposed. Nothing was published. Propose the change again to review it.",
      );
    }
    await requireFreshQualityChecks(ctx.asset, store);
    try {
      url = (await store.publishArticle(externalId, key)).url;
      await readBack(store, externalId, (a) => a.isPublished, "The publish");
    } catch (error) {
      await failPublication(publication, error);
      throw error;
    }
  }
  await ContentRepository.updatePublication(publication.id, {
    state: "published",
    externalId,
    externalUrl: url,
    publishedAt: new Date().toISOString(),
    error: null,
  });
  await ContentRepository.setAssetStatus(
    scope.projectId,
    ctx.asset.id,
    "published",
  );
  const after = { ...current, isPublished: true };
  return {
    externalId,
    url,
    record: {
      externalId,
      targetUrl: url,
      publicationStatus: "published" as const,
      diff: diffArticles(current, after).text,
      afterState: renderArticleState(after, externalId),
      rollback: planUnpublishRollback(externalId),
    },
  };
}

export async function executeShopifyChange(
  scope: Scope,
  entryId: string,
  input: ExecuteInput = {},
): Promise<ExecutionResult> {
  const ctx = await loadContext(scope, entryId);
  if (ctx.action === "update_existing") {
    if (input.confirmUpdate !== true) {
      throw new ContentRefusal(
        "This replaces the text of an existing article. Confirm the update to continue.",
      );
    }
    if (!input.targetExternalId) {
      throw new ContentRefusal("Choose the Shopify article to update.");
    }
  }

  // The approval choke point. Throws LedgerRefusal when the change is not
  // approved, was approved for another revision, or is already executing.
  await LedgerService.beginExecution(scope, entryId);

  try {
    const { store, blogId } = await storeForDraftDestination(
      scope.projectId,
      ctx.entry.beforeState,
    );
    ctx.blogId = blogId ?? ctx.blogId;
    const result =
      ctx.action === "create_draft"
        ? await createDraft(scope, ctx, store, input)
        : ctx.action === "update_existing"
          ? await updateExisting(scope, ctx, store, input)
          : await publishDraft(scope, ctx, store);
    const { rollback, ...record } = result.record;
    const entry = await LedgerService.recordExecution(scope, entryId, {
      ...record,
      rollback: {
        kind: rollback.kind,
        payload: JSON.stringify(rollback.payload),
      },
    });
    return { entry, externalId: result.externalId, url: result.url };
  } catch (error) {
    await LedgerService.recordFailure(scope, entryId, messageOf(error)).catch(
      () => undefined,
    );
    throw error;
  }
}
