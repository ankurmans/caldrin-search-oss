import type { LedgerEntry } from "@/server/features/ledger/types";
import type { ContentPublication } from "../repositories/PublicationRepository";
import type { StoreArticleDetail } from "../shopify/ShopifyStorePort";
import { renderArticleState } from "./articleDiff";

// Pure rules for deciding what happened to a Shopify write whose Worker died
// before the ledger heard the answer. Client code imports the small helpers
// below, so this file must stay free of server-only imports.

// A change that has been "executing" this long is not a request in flight.
export const MANUAL_CHECK_AFTER_MINUTES = 5;

// A failed publication whose outcome is unknown, so a retry does not risk a
// second article.
export const UNKNOWN_OUTCOME_PREFIX = "OUTCOME_UNKNOWN: ";

// Recorded in change_ledger_entries.error while the entry stays "executing":
// the check could not say whether Shopify applied the write.
export const NEEDS_REVIEW_PREFIX = "NEEDS_REVIEW: ";

export function needsReviewNote(
  entry: Pick<LedgerEntry, "status" | "error">,
): string | null {
  if (entry.status !== "executing") return null;
  return entry.error?.startsWith(NEEDS_REVIEW_PREFIX)
    ? entry.error.slice(NEEDS_REVIEW_PREFIX.length)
    : null;
}

// Ledger timestamps are SQL `current_timestamp` text: "YYYY-MM-DD HH:MM:SS" in
// UTC. ISO text with a "T" and "Z" also parses.
function parseUtc(value: string): number {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
}

// The entry moves to "executing" in one UPDATE that also bumps updated_at, and
// nothing touches the row until the executor records an outcome.
export function isStuckExecuting(
  entry: Pick<LedgerEntry, "status" | "updatedAt">,
  olderThanMinutes: number = MANUAL_CHECK_AFTER_MINUTES,
  now: number = Date.now(),
): boolean {
  if (entry.status !== "executing") return false;
  const since = parseUtc(entry.updatedAt);
  return Number.isFinite(since) && now - since >= olderThanMinutes * 60_000;
}

// The frozen before text of an update or publish starts with "Article: <id>".
export function targetOfEntry(beforeState: string | null): string | null {
  return /^Article: (.+)$/m.exec(beforeState ?? "")?.[1] ?? null;
}

export type ReconcileVerdict =
  | { outcome: "landed"; article: StoreArticleDetail }
  | { outcome: "not_landed"; reason: string }
  | { outcome: "review"; note: string };

const wasUnknown = (publication: ContentPublication | null) =>
  (publication?.error ?? "").startsWith(UNKNOWN_OUTCOME_PREFIX);

// Update or publish of an article whose id the proposal froze. The live text is
// compared with the two states a person approved between: before and after.
export function judgeExistingArticle(input: {
  entry: Pick<LedgerEntry, "beforeState" | "afterState">;
  publication: ContentPublication | null;
  live: StoreArticleDetail | null;
}): ReconcileVerdict {
  const { entry, publication, live } = input;
  if (!live) {
    return {
      outcome: "review",
      note: "The article could not be found in the store, so what happened to this change is unknown.",
    };
  }
  const state = renderArticleState(live, live.externalId);
  if (state === entry.afterState) {
    // Needs a record that this app started the write, or the match could be
    // someone typing the same text by hand.
    return publication
      ? { outcome: "landed", article: live }
      : {
          outcome: "review",
          note: "The article matches the approved text, but this app has no record of starting the write.",
        };
  }
  if (state === entry.beforeState) {
    if (wasUnknown(publication)) {
      return {
        outcome: "review",
        note: "Shopify never confirmed this write and the article still shows the old text. It may still be processing. Check again in a few minutes.",
      };
    }
    return {
      outcome: "not_landed",
      reason:
        "Shopify still has the text from before this change, so the write did not land. Approve it again to retry.",
    };
  }
  return {
    outcome: "review",
    note: "The article in Shopify matches neither the text before this change nor the approved text. It was probably edited in Shopify. Nothing was changed.",
  };
}
