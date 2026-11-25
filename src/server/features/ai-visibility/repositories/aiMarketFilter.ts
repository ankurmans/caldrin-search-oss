import { and, eq, sql, type SQL } from "drizzle-orm";
import { aiRuns, aiTrackerMarkets, aiTrackers } from "@/db/schema";

import type { AiMarketQuery } from "@/shared/ai-market";

/**
 * Narrows run queries to one market. With none given, a tracker that checks
 * extra markets reads as its own market, so no view blends countries; a
 * tracker without extra markets is not filtered at all.
 */
export function aiMarketCondition(market?: AiMarketQuery | null): SQL {
  if (market)
    return and(
      eq(aiRuns.locationCode, market.locationCode),
      market.languageCode
        ? eq(aiRuns.languageCode, market.languageCode)
        : undefined,
    )!;
  return sql`(not exists (select 1 from ${aiTrackerMarkets} where ${aiTrackerMarkets.trackerId} = ${aiRuns.trackerId}) or exists (select 1 from ${aiTrackers} where ${aiTrackers.id} = ${aiRuns.trackerId} and ${aiTrackers.locationCode} = ${aiRuns.locationCode} and ${aiTrackers.languageCode} = ${aiRuns.languageCode}))`;
}
