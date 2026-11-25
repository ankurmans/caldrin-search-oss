import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { requireConfiguration } from "./aiVisibilityMutation";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import type { CustomerContext } from "@/server/lib/customer-context";
import { normalizeAiSuggestion } from "@/shared/ai-prompt-suggestions";

/**
 * Asks the provider how often people ask an AI each active prompt's exact
 * wording in the tracker's market, and saves what it says. A prompt the
 * provider has no figure for is saved as "none reported", never as zero.
 */
export async function lookupPromptVolumes(
  input: { projectId: string },
  billing: CustomerContext,
) {
  const config = await requireConfiguration(input.projectId);
  const market = {
    locationCode: config.tracker.locationCode,
    languageCode: config.tracker.languageCode,
  };
  const prompts = config.prompts.filter((p) => !p.archived);
  if (!prompts.length) return { market, looked: 0, reported: 0 };
  const items = await createDataforseoClient({
    ...billing,
    projectId: input.projectId,
  }).aiSearch.keywordVolume({
    keywords: [...new Set(prompts.map((p) => p.text))],
    ...market,
  });
  const byWording = new Map(
    items.map((item) => [
      normalizeAiSuggestion(item.keyword),
      item.ai_search_volume ?? null,
    ]),
  );
  const rows = prompts.map((p) => ({
    promptId: p.id,
    volume: byWording.get(normalizeAiSuggestion(p.text)) ?? null,
  }));
  await repo.savePromptVolumes(market, rows);
  return {
    market,
    looked: rows.length,
    reported: rows.filter((r) => r.volume !== null).length,
  };
}
