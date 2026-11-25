import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { aiPrompts, aiPromptVolumes, aiTrackerMarkets } from "@/db/schema";
import type { AiMarket } from "@/shared/ai-market";

export async function listPromptVolumes(trackerId: string, market: AiMarket) {
  return db
    .select({
      promptId: aiPromptVolumes.promptId,
      volume: aiPromptVolumes.volume,
      fetchedAt: aiPromptVolumes.fetchedAt,
    })
    .from(aiPromptVolumes)
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiPromptVolumes.promptId))
    .where(
      and(
        eq(aiPrompts.trackerId, trackerId),
        eq(aiPromptVolumes.locationCode, market.locationCode),
        eq(aiPromptVolumes.languageCode, market.languageCode),
      ),
    );
}

export async function savePromptVolumes(
  market: AiMarket,
  rows: { promptId: string; volume: number | null }[],
) {
  const fetchedAt = new Date().toISOString();
  await runBatch((tx) =>
    rows.map((row) =>
      tx
        .insert(aiPromptVolumes)
        .values({ ...row, ...market, fetchedAt })
        .onConflictDoUpdate({
          target: [
            aiPromptVolumes.promptId,
            aiPromptVolumes.locationCode,
            aiPromptVolumes.languageCode,
          ],
          set: { volume: row.volume, fetchedAt },
        }),
    ),
  );
}

export async function listMarkets(trackerId: string): Promise<AiMarket[]> {
  return db
    .select({
      locationCode: aiTrackerMarkets.locationCode,
      languageCode: aiTrackerMarkets.languageCode,
    })
    .from(aiTrackerMarkets)
    .where(eq(aiTrackerMarkets.trackerId, trackerId))
    .orderBy(
      asc(aiTrackerMarkets.createdAt),
      asc(aiTrackerMarkets.locationCode),
    );
}

/** Replaces the tracker's extra markets with exactly these. */
export async function replaceMarkets(trackerId: string, markets: AiMarket[]) {
  const createdAt = new Date().toISOString();
  await runBatch((tx) => [
    tx
      .delete(aiTrackerMarkets)
      .where(eq(aiTrackerMarkets.trackerId, trackerId)),
    ...markets.map((market) =>
      tx.insert(aiTrackerMarkets).values({ trackerId, ...market, createdAt }),
    ),
  ]);
}
