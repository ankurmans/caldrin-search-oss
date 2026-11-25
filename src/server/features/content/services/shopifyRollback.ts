import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import type { LedgerEntry } from "@/server/features/ledger/types";
import { ContentRepository } from "../repositories/ContentRepository";
import { diffArticles, renderArticleState } from "../rules/articleDiff";
import { ContentRefusal } from "../rules/contentRefusal";
import { rollbackPayloadSchema } from "../rules/shopifyChange";
import type { RollbackPayload } from "../rules/shopifyChange";
import type { ShopifyStorePort } from "../shopify/ShopifyStorePort";
import { storeForProject } from "./shopifyConnection";
import type { Scope } from "./shopifyConnection";

type RollbackInput = {
  // Restoring overwrites whatever the article says now. If it was edited in
  // Shopify after this change, the rollback refuses unless this is true.
  overwriteLaterEdits?: boolean;
  // For a rollback recorded as manual: the person restored it themselves in
  // Shopify and wants the change marked rolled back.
  manuallyRestored?: boolean;
};

type RollbackResult =
  | { status: "rolled_back"; entry: LedgerEntry; note: string }
  // Shopify cannot restore this one; nothing was changed. `instructions` says
  // what to do by hand, `previous` is the exact text to put back.
  | {
      status: "manual";
      instructions: string;
      previous: Extract<RollbackPayload, { type: "manual" }>["previous"];
    };

function parsePayload(raw: string): RollbackPayload {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  const parsed = rollbackPayloadSchema.safeParse(json);
  if (!parsed.success) {
    throw new ContentRefusal(
      "The rollback record for this change is unreadable. Restore it by hand in Shopify.",
    );
  }
  return parsed.data;
}

async function restore(
  store: ShopifyStorePort,
  entry: LedgerEntry,
  payload: Extract<RollbackPayload, { type: "restore" }>,
  input: RollbackInput,
): Promise<string> {
  const current = await store.getArticle(payload.externalId);
  if (!current) {
    throw new ContentRefusal("That article no longer exists in the store.");
  }
  // What Shopify holds must still be what this change wrote.
  const wrote = renderArticleState(current, payload.externalId);
  if (wrote !== entry.afterState && input.overwriteLaterEdits !== true) {
    const lost = diffArticles(
      { ...payload.fields, isPublished: current.isPublished },
      current,
    );
    throw new ContentRefusal(
      `The article was edited in Shopify after this change. Restoring would overwrite those edits. Nothing was written. Differences from the text before this change:\n${lost.text}`,
    );
  }
  await store.updateArticle(payload.externalId, payload.fields);
  return "The previous text was restored in Shopify.";
}

// Keeps our own records honest once an article is no longer public, whichever
// change (the create or the publish) is being rolled back.
async function markUnpublished(
  scope: Scope,
  entry: LedgerEntry,
  externalId: string,
) {
  if (!entry.contentAssetId) return;
  const publications = await ContentRepository.listPublications(
    entry.contentAssetId,
  );
  for (const publication of publications) {
    if (
      publication.externalId === externalId &&
      publication.state === "published"
    ) {
      await ContentRepository.updatePublication(publication.id, {
        state: "draft_created",
        publishedAt: null,
      });
    }
  }
  const asset = await ContentRepository.getAsset(
    scope.projectId,
    entry.contentAssetId,
  );
  if (asset?.status === "published") {
    await ContentRepository.setAssetStatus(
      scope.projectId,
      asset.id,
      "approved",
    );
  }
}

// Ledger entries that were executed can be put back: updates restore the
// previous text, created or published articles are unpublished. No path here
// deletes an article.
export async function rollbackShopifyChange(
  scope: Scope,
  entryId: string,
  input: RollbackInput = {},
): Promise<RollbackResult> {
  const { entry } = await LedgerService.getEntry(scope.projectId, entryId);
  if (entry.provider !== "shopify") {
    throw new ContentRefusal("This is not a Shopify content change.");
  }
  // Refuses unless executed and a rollback was recorded.
  const planned = await LedgerService.beginRollback(scope, entryId);
  const payload = parsePayload(planned.payload);

  if (payload.type === "manual") {
    if (input.manuallyRestored !== true) {
      return {
        status: "manual",
        instructions: payload.instructions,
        previous: payload.previous,
      };
    }
    const done = await LedgerService.recordRollback(scope, entryId);
    return {
      status: "rolled_back",
      entry: done,
      note: "Marked as rolled back by hand. Shopify was not changed by this app.",
    };
  }

  const store = await storeForProject(scope.projectId);
  let note: string;
  if (payload.type === "restore") {
    note = await restore(store, entry, payload, input);
  } else {
    const current = await store.getArticle(payload.externalId);
    if (!current) {
      throw new ContentRefusal("That article no longer exists in the store.");
    }
    if (current.isPublished) {
      await store.unpublishArticle(payload.externalId);
      await markUnpublished(scope, entry, payload.externalId);
    }
    note =
      "The article is unpublished. It remains in the Shopify admin as a draft: this app never deletes articles.";
  }
  const done = await LedgerService.recordRollback(scope, entryId);
  return { status: "rolled_back", entry: done, note };
}
