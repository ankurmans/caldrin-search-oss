import { LedgerRefusal, type LedgerEntry } from "../types";

// What a change needs before any source can be read for it. Shared by every
// collector so a draft or an unexecuted change is refused the same way.
export function requireMeasurable(entry: LedgerEntry): {
  targetUrl: string;
  executedAt: string;
} {
  if (entry.status !== "executed") {
    throw new LedgerRefusal("Only an executed change can be measured.");
  }
  if (entry.publicationStatus !== "published") {
    throw new LedgerRefusal(
      "Only a published change can be measured: a draft has no search data.",
    );
  }
  if (!entry.targetUrl) {
    throw new LedgerRefusal("This change has no target URL to measure.");
  }
  if (!entry.executedAt) {
    throw new LedgerRefusal("This change has no execution time.");
  }
  return { targetUrl: entry.targetUrl, executedAt: entry.executedAt };
}
