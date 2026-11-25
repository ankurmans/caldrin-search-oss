import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { AiVisibilityError } from "./aiVisibilityErrors";
import { trackerEngines } from "./aiVisibilityConfiguration";
import { marketError } from "./aiVisibilityMarket";
import { requireConfiguration } from "./aiVisibilityMutation";
import { getTracker } from "./aiVisibilityState";
import type { SetAiMarketsInput } from "@/types/schemas/ai-visibility";

/**
 * Sets the countries a tracker checks besides its own. Saving charges nothing;
 * every market is its own run from the next check on.
 */
export async function setMarkets(input: SetAiMarketsInput) {
  const { tracker } = await requireConfiguration(input.projectId);
  const engines = trackerEngines(tracker);
  const seen = new Set<string>();
  for (const market of input.markets) {
    const key = `${market.locationCode}:${market.languageCode}`;
    if (
      seen.has(key) ||
      (market.locationCode === tracker.locationCode &&
        market.languageCode === tracker.languageCode)
    )
      throw new AiVisibilityError(
        "DUPLICATE_MARKET",
        "Each market must differ from the tracker's own market and from the other markets listed.",
      );
    seen.add(key);
    const problem = marketError(engines, market);
    if (problem) throw new AiVisibilityError("UNSUPPORTED_MARKET", problem);
  }
  await repo.replaceMarkets(tracker.id, input.markets);
  return getTracker(input);
}
