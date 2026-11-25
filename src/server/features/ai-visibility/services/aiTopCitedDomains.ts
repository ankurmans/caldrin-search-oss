import { sortBy } from "remeda";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { requireConfiguration } from "./aiVisibilityMutation";
import { classifySource } from "@/server/features/source-intelligence/rules/sourceClass";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import {
  buildLlmTarget,
  CHATGPT_LANGUAGE_CODE,
  CHATGPT_LOCATION_CODE,
} from "@/server/lib/dataforseo";
import { AppError } from "@/server/lib/errors";
import type { CustomerContext } from "@/server/lib/customer-context";
import type { TopCitedDomainsInput } from "@/types/schemas/ai-visibility";

const bareHost = (value: string) => value.toLowerCase().replace(/^www\./, "");

/**
 * The domains the provider's engine cites most in answers about a topic (or,
 * with no topic, in answers that mention the project's own domain), each
 * marked as the project's own, a saved competitor's, or neither. Counts are
 * the provider's, not our runs'.
 */
export async function topCitedDomains(
  input: TopCitedDomainsInput,
  billing: CustomerContext,
) {
  const config = await requireConfiguration(input.projectId);
  const project = await repo.getProject(input.projectId);
  if (!project?.domain) throw new AppError("NOT_FOUND");
  const own = bareHost(project.domain);
  const competitors = new Set(
    (await repo.listCompetitors(input.projectId)).map((c) =>
      bareHost(c.domain),
    ),
  );
  // The ChatGPT data covers one market only.
  const market =
    input.platform === "chat_gpt"
      ? {
          locationCode: CHATGPT_LOCATION_CODE,
          languageCode: CHATGPT_LANGUAGE_CODE,
        }
      : {
          locationCode: config.tracker.locationCode,
          languageCode: config.tracker.languageCode,
        };
  const items = await createDataforseoClient({
    ...billing,
    projectId: input.projectId,
  }).aiSearch.topDomains({
    target: input.keyword
      ? buildLlmTarget({ type: "keyword", value: input.keyword })
      : buildLlmTarget({ type: "domain", value: own }),
    platform: input.platform,
    ...market,
    itemsListLimit: input.limit,
  });
  const domains = items.flatMap((item) => {
    const host = item.key ? bareHost(item.key) : null;
    if (!host) return [];
    const group = item.platform?.find((entry) => entry.key === input.platform);
    const owner =
      host === own || host.endsWith(`.${own}`)
        ? ("own" as const)
        : competitors.has(host)
          ? ("competitor" as const)
          : null;
    return [
      {
        domain: host,
        owner: owner ?? "other",
        sourceClass: classifySource({ host, brand: owner }),
        mentions: group?.mentions ?? null,
        aiSearchVolume: group?.ai_search_volume ?? null,
      },
    ];
  });
  return {
    target: input.keyword ?? own,
    platform: input.platform,
    market,
    domains: sortBy(domains, [(d) => d.mentions ?? 0, "desc"]),
  };
}
