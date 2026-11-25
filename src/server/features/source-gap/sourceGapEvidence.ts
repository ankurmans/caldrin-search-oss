import {
  isAnswered,
  type IntelFact,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";
import {
  normalizeDomain,
  type CitedSource,
} from "@/server/features/citation-gaps/citationSourceRules";
import { aiEngineUsesModelApi, type AiEngine } from "@/shared/ai-visibility";
import type {
  CitedSourceSummary,
  CollectionMode,
  PromptAnswerStats,
} from "@/shared/source-gap";
import { classifySource } from "./sourceClassification";
import { normalizeSourceUrl } from "./sourceUrl";

type Brand = { name: string; domain: string; own: boolean };

/** Every tracked brand seen in the answers, once. */
export function brandsOf(facts: IntelFact[]): Brand[] {
  const byDomain = new Map<string, Brand>();
  for (const fact of facts)
    for (const m of fact.brands)
      if (!byDomain.has(m.domain))
        byDomain.set(m.domain, {
          name: m.name || m.domain,
          domain: m.domain,
          own: m.own,
        });
  return [...byDomain.values()];
}

export function collectionModeOf(engines: AiEngine[]): CollectionMode {
  const api = engines.filter((e) => aiEngineUsesModelApi(e)).length;
  if (api === 0) return "scraper";
  return api === engines.length ? "api_benchmark" : "mixed";
}

/** What the stored answers to one prompt say about you and your competitors. */
export function promptStats(facts: IntelFact[]): PromptAnswerStats {
  const answered = facts.filter(isAnswered);
  const engines = new Map<AiEngine, number>();
  let ownMentions = 0;
  let ownCitations = 0;
  let competitorMentions = 0;
  let competitorOnly = 0;
  for (const fact of answered) {
    engines.set(fact.engine, (engines.get(fact.engine) ?? 0) + 1);
    const own = fact.brands.some((b) => b.own && b.mentioned);
    const rival = fact.brands.some((b) => !b.own && b.mentioned);
    if (own) ownMentions++;
    if (fact.brands.some((b) => b.own && b.cited)) ownCitations++;
    if (rival) competitorMentions++;
    if (rival && !own) competitorOnly++;
  }
  return {
    engines: [...engines].map(([engine, answers]) => ({ engine, answers })),
    answers: answered.length,
    ownMentions,
    ownCitations,
    competitorMentions,
    answersWithCompetitorOnly: competitorOnly,
  };
}

/**
 * The distinct pages cited across a prompt's answers, one row per normalized
 * address, with the answers and engines behind each. Pages cited by more
 * answers come first.
 */
export function summarizeCitedSources(
  facts: IntelFact[],
  cited: CitedSource[],
  brands: Brand[],
): CitedSourceSummary[] {
  const byId = new Map(facts.filter(isAnswered).map((f) => [f.id, f]));
  const groups = new Map<string, CitedSourceSummary>();
  for (const source of cited) {
    const fact = byId.get(source.observationId);
    const key = normalizeSourceUrl(source.url);
    if (!fact || !key) continue;
    const domain = normalizeDomain(source.domain);
    const found = groups.get(key);
    const group: CitedSourceSummary = found ?? {
      url: key,
      domain,
      title: source.title,
      ...(() => {
        const kind = classifySource({ ...source, domain }, brands);
        return { sourceType: kind.type, brandName: kind.brandName };
      })(),
      answers: 0,
      engines: [],
      bestPosition: null,
      observationIds: [],
      brandsNamedInAnswers: [],
      ownNamedInAnswers: false,
      snapshot: null,
      brandsOnPage: [],
      ownOnPage: false,
    };
    group.title ??= source.title;
    if (!group.observationIds.includes(source.observationId)) {
      group.observationIds.push(source.observationId);
      group.answers++;
      if (!group.engines.includes(fact.engine)) group.engines.push(fact.engine);
      for (const m of fact.brands) {
        if (!m.mentioned) continue;
        if (m.own) group.ownNamedInAnswers = true;
        else if (!group.brandsNamedInAnswers.includes(m.name || m.domain))
          group.brandsNamedInAnswers.push(m.name || m.domain);
      }
    }
    if (source.position !== undefined)
      group.bestPosition = Math.min(
        group.bestPosition ?? source.position,
        source.position,
      );
    groups.set(key, group);
  }
  const out = [...groups.values()];
  out.sort((a, b) => b.answers - a.answers || a.url.localeCompare(b.url));
  return out;
}
