import { and, eq, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { changeLedgerEntries } from "@/db/schema";
import type { LedgerEntry } from "@/server/features/ledger/types";

// Reads and one note-only write on ledger rows, for the crash-recovery check.
// Status moves still go through LedgerService; nothing here changes status.

const MAX_PER_RUN = 50;

// updated_at is SQL `current_timestamp` text, "YYYY-MM-DD HH:MM:SS" in UTC, so
// the cutoff is compared as the same text.
function sqlTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

async function listStuckShopifyEntries(input: {
  olderThanMinutes: number;
  projectId?: string;
  now?: number;
}): Promise<LedgerEntry[]> {
  const cutoff = sqlTimestamp(
    (input.now ?? Date.now()) - input.olderThanMinutes * 60_000,
  );
  return db
    .select()
    .from(changeLedgerEntries)
    .where(
      and(
        eq(changeLedgerEntries.provider, "shopify"),
        eq(changeLedgerEntries.status, "executing"),
        lte(changeLedgerEntries.updatedAt, cutoff),
        input.projectId
          ? eq(changeLedgerEntries.projectId, input.projectId)
          : undefined,
      ),
    )
    .orderBy(changeLedgerEntries.updatedAt)
    .limit(MAX_PER_RUN);
}

// Records why a stuck entry was left alone. Does not touch updated_at, so the
// entry keeps its age and the next check still sees it as stuck.
async function noteNeedsReview(
  projectId: string,
  entryId: string,
  text: string,
): Promise<void> {
  await db
    .update(changeLedgerEntries)
    .set({ error: text })
    .where(
      and(
        eq(changeLedgerEntries.projectId, projectId),
        eq(changeLedgerEntries.id, entryId),
        eq(changeLedgerEntries.status, "executing"),
      ),
    );
}

// Article ids that another change already recorded, so a text match in the
// store is not mistaken for this change's article.
async function recordedExternalIds(
  projectId: string,
  exceptEntryId: string,
  externalIds: string[],
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const rows = await db
    .select({ externalId: changeLedgerEntries.externalId })
    .from(changeLedgerEntries)
    .where(
      and(
        eq(changeLedgerEntries.projectId, projectId),
        ne(changeLedgerEntries.id, exceptEntryId),
        inArray(changeLedgerEntries.externalId, externalIds),
      ),
    );
  return new Set(rows.flatMap((r) => (r.externalId ? [r.externalId] : [])));
}

export const ShopifyReconcileRepository = {
  listStuckShopifyEntries,
  noteNeedsReview,
  recordedExternalIds,
};
