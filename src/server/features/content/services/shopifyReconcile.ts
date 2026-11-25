import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { LedgerRefusal } from "@/server/features/ledger/types";
import type { LedgerEntry } from "@/server/features/ledger/types";
import { ContentRepository } from "../repositories/ContentRepository";
import type { ContentPublication } from "../repositories/PublicationRepository";
import { ShopifyReconcileRepository } from "../repositories/ShopifyReconcileRepository";
import { diffArticles, renderArticleState } from "../rules/articleDiff";
import { ContentRefusal } from "../rules/contentRefusal";
import { actionFromKey } from "../rules/publishPolicy";
import { planUnpublishRollback } from "../rules/shopifyChange";
import {
  MANUAL_CHECK_AFTER_MINUTES,
  NEEDS_REVIEW_PREFIX,
  UNKNOWN_OUTCOME_PREFIX,
  isStuckExecuting,
  judgeExistingArticle,
  needsReviewNote,
  targetOfEntry,
} from "../rules/shopifyReconcileRules";
import type { ReconcileVerdict } from "../rules/shopifyReconcileRules";
import type {
  ShopifyStorePort,
  StoreArticleDetail,
} from "../shopify/ShopifyStorePort";
import { storeForProject } from "./shopifyConnection";
import { storeForDraftDestination } from "./shopifyDraftDestination";

// Crash recovery. If the Worker dies between LedgerService.beginExecution and
// recordExecution, the entry stays "executing" forever. This reads the store
// and decides what happened. It only ever READS Shopify: it never re-issues a
// write, and when the store cannot settle the question it leaves the entry
// alone with a recorded note.

export type ReconcileOutcome =
  | "executed"
  | "failed"
  | "needs_review"
  // The change finished on its own while it was being checked.
  | "already_resolved";

export type ReconcileResult = {
  outcome: ReconcileOutcome;
  note: string;
  entry: LedgerEntry;
};

const MAX_NOTE = 400;
const MAX_CANDIDATES = 10;

const isUnknown = (p: ContentPublication) =>
  (p.error ?? "").startsWith(UNKNOWN_OUTCOME_PREFIX);

// The person who started the execution stays on record as its executor.
function scopeOf(entry: LedgerEntry) {
  return {
    projectId: entry.projectId,
    organizationId: entry.organizationId,
    userId: entry.executedByUserId ?? entry.requestedByUserId,
  };
}

const review = (note: string): ReconcileVerdict => ({
  outcome: "review",
  note,
});

// A create has no article id in the proposal, so after a crash the article is
// found by its exact approved text, and only if no other change owns it.
async function findCreatedArticle(
  entry: LedgerEntry,
  store: ShopifyStorePort,
  blogId: string | null,
): Promise<ReconcileVerdict> {
  const title = /^Title: (.*)$/m.exec(entry.afterState ?? "")?.[1];
  if (!title) return review("This change has no recorded article text.");
  const summaries = (await store.listArticles()).filter(
    (a) => a.title === title,
  );
  const owned = await ShopifyReconcileRepository.recordedExternalIds(
    entry.projectId,
    entry.id,
    summaries.map((a) => a.externalId),
  );
  const matches: StoreArticleDetail[] = [];
  for (const summary of summaries.slice(0, MAX_CANDIDATES)) {
    if (owned.has(summary.externalId)) continue;
    const article = await store.getArticle(summary.externalId);
    if (
      article &&
      (!blogId || article.blogId === blogId) &&
      renderArticleState(article) === entry.afterState
    ) {
      matches.push(article);
    }
  }
  const [only] = matches;
  if (matches.length === 1 && only) return { outcome: "landed", article: only };
  return review(
    matches.length === 0
      ? "Shopify did not confirm creating the article and no matching draft was found. Check the store's blog for it, then check again here."
      : "Several articles in the store match this draft, so it is unclear which one this change made. Check the store's blog.",
  );
}

async function judgeCreate(
  entry: LedgerEntry,
  publication: ContentPublication | null,
): Promise<ReconcileVerdict> {
  if (!publication) {
    return {
      outcome: "not_landed",
      reason:
        "No attempt to create the article was recorded, so nothing was sent to Shopify. Approve it again to retry.",
    };
  }
  if (publication.state === "failed" && !isUnknown(publication)) {
    return {
      outcome: "not_landed",
      reason: `Shopify refused the write: ${publication.error ?? "no reason recorded"}. Approve it again to retry.`,
    };
  }
  const { store, blogId } = await storeForDraftDestination(
    entry.projectId,
    entry.beforeState,
  );
  if (publication.externalId) {
    const live = await store.getArticle(publication.externalId);
    return live && (!blogId || live.blogId === blogId)
      ? { outcome: "landed", article: live }
      : {
          outcome: "review",
          note: "The article this change created is no longer in the store.",
        };
  }
  return findCreatedArticle(entry, store, blogId);
}

async function judge(
  entry: LedgerEntry,
  action: "create_draft" | "update" | "publish",
): Promise<ReconcileVerdict> {
  const publication = await ContentRepository.findPublication(
    entry.idempotencyKey ?? "",
  );
  if (action === "create_draft") return judgeCreate(entry, publication);
  const externalId = targetOfEntry(entry.beforeState);
  if (!externalId) {
    return {
      outcome: "review",
      note: "This change has no recorded target article.",
    };
  }
  const store = await storeForProject(entry.projectId);
  return judgeExistingArticle({
    entry,
    publication,
    live: await store.getArticle(externalId),
  });
}

// The write landed: record what is really in the store, and bring our own
// publication and draft records in line, as the normal executor would have.
async function recordLanded(
  entry: LedgerEntry,
  action: "create_draft" | "update" | "publish",
  article: StoreArticleDetail,
): Promise<LedgerEntry> {
  const key = entry.idempotencyKey ?? "";
  const publication = await ContentRepository.findPublication(key);
  const id = article.externalId;
  if (publication) {
    await ContentRepository.updatePublication(publication.id, {
      state: article.isPublished ? "published" : "draft_created",
      externalId: id,
      externalUrl: article.url,
      publishedAt: article.isPublished ? new Date().toISOString() : undefined,
      error: null,
    });
  }
  if (
    article.isPublished &&
    action !== "create_draft" &&
    entry.contentAssetId
  ) {
    await ContentRepository.setAssetStatus(
      entry.projectId,
      entry.contentAssetId,
      "published",
    );
  }
  const recovered = {
    externalId: id,
    targetUrl: article.url,
    publicationStatus: article.isPublished
      ? ("published" as const)
      : ("draft" as const),
    afterState: renderArticleState(article, id),
  };
  const executed =
    action === "update"
      ? await LedgerService.recordExecution(scopeOf(entry), entry.id, {
          ...recovered,
          // The exact previous text was only held in memory by the Worker that
          // died, so no restore can be offered. The frozen before text stays on
          // this change for a manual restore.
          diff: "Recovered after the Worker stopped mid-write: Shopify holds the approved text. The previous text is kept in this change's before record; no automatic rollback was recorded.",
        })
      : await LedgerService.recordExecution(scopeOf(entry), entry.id, {
          ...recovered,
          diff:
            action === "create_draft"
              ? diffArticles(null, article).text
              : diffArticles({ ...article, isPublished: false }, article).text,
          rollback: {
            kind: "unpublish",
            payload: JSON.stringify(planUnpublishRollback(id).payload),
          },
        });
  return executed;
}

async function recordNotLanded(
  entry: LedgerEntry,
  reason: string,
): Promise<LedgerEntry> {
  const publication = await ContentRepository.findPublication(
    entry.idempotencyKey ?? "",
  );
  // A definite failure, so approving the change again is allowed to retry.
  if (publication && publication.state === "pending") {
    await ContentRepository.updatePublication(publication.id, {
      state: "failed",
      error: reason.slice(0, 500),
    });
  }
  return LedgerService.recordFailure(
    scopeOf(entry),
    entry.id,
    `Recovered after the Worker stopped mid-write. ${reason}`,
  );
}

async function leaveForReview(
  entry: LedgerEntry,
  note: string,
): Promise<ReconcileResult> {
  const text = note.slice(0, MAX_NOTE);
  await ShopifyReconcileRepository.noteNeedsReview(
    entry.projectId,
    entry.id,
    `${NEEDS_REVIEW_PREFIX}${text}`,
  );
  return { outcome: "needs_review", note: text, entry };
}

async function reconcileEntry(entry: LedgerEntry): Promise<ReconcileResult> {
  const action = actionFromKey(entry.idempotencyKey ?? "");
  if (!action) return leaveForReview(entry, "This is not a Shopify change.");
  let verdict: ReconcileVerdict;
  try {
    verdict = await judge(entry, action);
  } catch (error) {
    // No connection, a read error, an unknown outcome: never guess.
    const why = error instanceof Error ? error.message : "unknown error";
    return leaveForReview(
      entry,
      `Could not read the store to check this change: ${why}`,
    );
  }
  if (verdict.outcome === "review") return leaveForReview(entry, verdict.note);
  try {
    if (verdict.outcome === "landed") {
      const done = await recordLanded(entry, action, verdict.article);
      return {
        outcome: "executed",
        note: "Shopify has the approved text. The change is now recorded as executed.",
        entry: done,
      };
    }
    const failed = await recordNotLanded(entry, verdict.reason);
    return { outcome: "failed", note: verdict.reason, entry: failed };
  } catch (error) {
    if (!(error instanceof LedgerRefusal)) throw error;
    // The original request finished while this check ran; its answer stands.
    const { entry: current } = await LedgerService.getEntry(
      entry.projectId,
      entry.id,
    );
    return {
      outcome: "already_resolved",
      note: `This change finished on its own: it is now ${current.status.replace("_", " ")}.`,
      entry: current,
    };
  }
}

// For the scheduled job: every Shopify change stuck in "executing" longer than
// the threshold, across projects (or one project).
export async function reconcileStuckExecutions(opts: {
  olderThanMinutes: number;
  projectId?: string;
}): Promise<{
  checked: number;
  markedExecuted: number;
  markedFailed: number;
  needsReview: number;
}> {
  const entries =
    await ShopifyReconcileRepository.listStuckShopifyEntries(opts);
  const totals = {
    checked: 0,
    markedExecuted: 0,
    markedFailed: 0,
    needsReview: 0,
  };
  for (const entry of entries) {
    totals.checked += 1;
    try {
      const { outcome } = await reconcileEntry(entry);
      if (outcome === "executed") totals.markedExecuted += 1;
      if (outcome === "failed") totals.markedFailed += 1;
      if (outcome === "needs_review") totals.needsReview += 1;
    } catch (error) {
      // One bad entry must not stop the rest. It stays executing for the
      // next run.
      console.error("shopify.reconcile.entry_failed", entry.id, error);
      totals.needsReview += 1;
    }
  }
  return totals;
}

// For one entry, from the "Check what happened" button.
export async function reconcileShopifyChange(
  projectId: string,
  entryId: string,
): Promise<ReconcileResult> {
  const { entry } = await LedgerService.getEntry(projectId, entryId);
  if (entry.provider !== "shopify") {
    throw new ContentRefusal("This is not a Shopify content change.");
  }
  if (entry.status !== "executing") {
    throw new ContentRefusal(
      `This change is not stuck: it is ${entry.status.replace("_", " ")}.`,
    );
  }
  if (!isStuckExecuting(entry, MANUAL_CHECK_AFTER_MINUTES)) {
    throw new ContentRefusal(
      `This change started less than ${MANUAL_CHECK_AFTER_MINUTES} minutes ago and may still be running. Check again later.`,
    );
  }
  return reconcileEntry(entry);
}

// For a change the store check could not settle: a person looked at the store
// and confirms the write is not there. The change is recorded as failed, so it
// can be approved again, and the person who decided is kept on the entry.
export async function markShopifyChangeNotApplied(
  scope: { projectId: string; organizationId: string; userId: string },
  entryId: string,
): Promise<LedgerEntry> {
  const { entry } = await LedgerService.getEntry(scope.projectId, entryId);
  if (entry.provider !== "shopify") {
    throw new ContentRefusal("This is not a Shopify content change.");
  }
  if (needsReviewNote(entry) === null) {
    throw new ContentRefusal(
      entry.status === "executing"
        ? "Check what happened first. This is only for a change the store check could not settle."
        : `This change is not stuck: it is ${entry.status.replace("_", " ")}.`,
    );
  }
  await recordNotLanded(
    entry,
    "Marked as not applied after a manual check of the store.",
  );
  return LedgerService.recordFailureDecision(
    scope,
    entry.id,
    "Checked the store by hand: the change is not there.",
  );
}
