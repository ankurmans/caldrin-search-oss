import { sort, unique } from "remeda";
import { PERCEPTION_CLASSIFIER_VERSION } from "@/shared/ai-perception";
import type {
  AiPerceptionSources,
  PerceptionSourceEvidence,
  PerceptionSourceRow,
} from "@/shared/ai-perception-sources";
import type { AiEngine } from "@/shared/ai-visibility";
import type { AiIntelligenceInput } from "@/types/schemas/ai-visibility-intelligence";
import { AiIntelligenceRepository } from "@/server/features/ai-visibility/repositories/aiIntelligenceRepository";
import { AiVisibilityRepository as visibility } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import {
  applyFilters,
  selectIntelRuns,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligence";
import { isAnswered } from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";
import { toRate } from "@/server/features/ai-visibility/services/aiMeasurementStats";
import { classifySource } from "@/server/features/source-intelligence/rules/sourceClass";
import { AiPerceptionRepository as repo } from "../repositories/AiPerceptionRepository";
import { answersFor, populationFor, readingIndex } from "./aiPerceptionView";
import { brandPerception, outcomeOf, zeroCounts } from "./perceptionMetrics";
import { groupThemes, type ThemePoint } from "./perceptionThemes";

const MAX_SOURCES = 60;
const MAX_PAGES = 3;

/** The facts the figures cover and the brand they are about. */
async function scope(input: AiIntelligenceInput) {
  const selected = await selectIntelRuns(input);
  const facts = applyFilters(
    await AiIntelligenceRepository.getFacts(
      selected.selectedRuns.map((r) => r.id),
    ),
    input,
  );
  const domain =
    input.brand ??
    facts.flatMap((f) => f.brands).find((b) => b.own)?.domain ??
    null;
  return { selected, facts, domain };
}

/**
 * Where the answers that name the brand got their sources, set beside how each
 * answer treated the brand, and the reasons answers give for hesitating. These
 * are associations in saved answers; nothing here says a source caused a
 * perception.
 */
export async function loadPerceptionSources(
  input: AiIntelligenceInput,
): Promise<AiPerceptionSources> {
  const { selected, facts, domain } = await scope(input);
  const answered = facts.filter(
    (f) => isAnswered(f) && domain && f.brands.some((b) => b.domain === domain),
  );
  const ids = answered.map((f) => f.id);
  const index = await readingIndex(selected.selectedRuns.map((r) => r.id));
  const population = populationFor(input, selected, facts);
  const brandRow = answered
    .flatMap((f) => f.brands)
    .find((b) => b.domain === domain);
  const brand = brandRow
    ? { name: brandRow.name, domain: brandRow.domain }
    : null;
  const empty: AiPerceptionSources = {
    population,
    brand,
    baseline: toRate(0, 0),
    sources: [],
    themes: [],
    notes: [],
  };
  if (!domain || !ids.length) {
    return {
      ...empty,
      notes: ["No answers that track this brand in this window."],
    };
  }
  const baseline = brandPerception(facts, domain, index).recommendedOfMentions;
  const [{ sources: cited }, retrieved, stored] = await Promise.all([
    visibility.getEvidence(ids),
    repo.listRetrievedDomains(ids),
    repo.listForObservations(ids, PERCEPTION_CLASSIFIER_VERSION),
  ]);
  const factById = new Map(answered.map((f) => [f.id, f]));
  const brandDomains = new Map(
    answered
      .flatMap((f) => f.brands)
      .map((b) => [b.domain, b.own ? "own" : "competitor"] as const),
  );
  const byDomain = new Map<
    string,
    { rows: typeof cited; observations: Set<string> }
  >();
  for (const s of cited) {
    const entry = byDomain.get(s.domain) ?? {
      rows: [],
      observations: new Set(),
    };
    entry.rows.push(s);
    entry.observations.add(s.observationId);
    byDomain.set(s.domain, entry);
  }
  const retrievedBy = new Map<string, Set<string>>();
  for (const r of retrieved) {
    const set = retrievedBy.get(r.domain) ?? new Set();
    set.add(r.observationId);
    retrievedBy.set(r.domain, set);
  }
  const anyRetrievals = retrieved.length > 0;
  const rows: PerceptionSourceRow[] = [...byDomain.entries()].map(
    ([sourceDomain, { rows: sourceRows, observations }]) => {
      const outcomes = zeroCounts();
      const engines: AiEngine[] = [];
      for (const id of observations) {
        const fact = factById.get(id);
        if (!fact) continue;
        const outcome = outcomeOf(fact, domain, index) ?? "missing";
        outcomes[outcome] += 1;
        engines.push(fact.engine);
      }
      const read = outcomes.recommended + outcomes.neutral + outcomes.negative;
      const pages = new Map<
        string,
        { title: string | null; answers: Set<string> }
      >();
      for (const s of sourceRows) {
        const page = pages.get(s.url) ?? { title: s.title, answers: new Set() };
        page.answers.add(s.observationId);
        pages.set(s.url, page);
      }
      const retrievedOnly = [...(retrievedBy.get(sourceDomain) ?? [])].filter(
        (id) => !observations.has(id),
      ).length;
      return {
        domain: sourceDomain,
        sourceClass: classifySource({
          host: sourceDomain,
          title: sourceRows[0]?.title,
          brand: brandDomains.get(sourceDomain) ?? null,
        }),
        title: sourceRows[0]?.title ?? null,
        answers: observations.size,
        outcomes,
        recommended: toRate(outcomes.recommended, read),
        retrievedNotCited: anyRetrievals ? retrievedOnly : null,
        engines: unique(engines),
        pages: sort(
          [...pages.entries()].map(([url, p]) => ({
            url,
            title: p.title,
            answers: p.answers.size,
          })),
          (a, b) => b.answers - a.answers,
        ).slice(0, MAX_PAGES),
      };
    },
  );
  const readings = stored.filter((p) => p.domain === domain);
  const promptOf = new Map(answered.map((f) => [f.id, f.promptId]));
  const points: ThemePoint[] = readings.flatMap((p) => {
    const fact = factById.get(p.observationId);
    return fact
      ? p.points
          .filter((x) => x.kind !== "strength")
          .map((x) => ({
            observationId: p.observationId,
            promptId: fact.promptId,
            engine: fact.engine,
            kind: x.kind,
            text: x.text,
            quote: x.quote,
          }))
      : [];
  });
  const notes = [
    ...(readings.length
      ? []
      : [
          "No answers about this brand have been read yet, so there are no themes and the source split is only counts.",
        ]),
    ...(anyRetrievals
      ? []
      : [
          "No engine in this window reports the pages it retrieved, so retrieved-but-not-cited cannot be shown.",
        ]),
  ];
  return {
    population,
    brand,
    baseline,
    sources: sort(
      rows,
      (a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain),
    ).slice(0, MAX_SOURCES),
    themes: groupThemes(points, readings.length, promptOf),
    notes,
  };
}

/** The answers that cite one source, with the brand's reading in each. */
export async function loadPerceptionSourceEvidence(
  input: AiIntelligenceInput & { domain: string; sourceDomain: string },
): Promise<PerceptionSourceEvidence> {
  const { facts } = await scope(input);
  const answered = facts.filter(isAnswered);
  const { sources } = await visibility.getEvidence(answered.map((f) => f.id));
  const citing = sources.filter((s) => s.domain === input.sourceDomain);
  const wanted = new Set(citing.map((s) => s.observationId));
  const { brand, answers } = await answersFor(
    answered.filter((f) => wanted.has(f.id)),
    input.domain,
  );
  return {
    domain: input.sourceDomain,
    brand,
    pages: sort(
      citing.map((s) => ({ url: s.url, title: s.title, position: s.position })),
      (a, b) => a.position - b.position,
    ),
    answers,
  };
}
