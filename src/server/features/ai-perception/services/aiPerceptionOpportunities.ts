import { sort, unique } from "remeda";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import type { OpportunityCandidate } from "@/server/features/opportunities/types";
import { AiIntelligenceRepository } from "@/server/features/ai-visibility/repositories/aiIntelligenceRepository";
import {
  applyFilters,
  selectIntelRuns,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligence";
import { isAnswered } from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";
import { factCheckReport } from "@/server/features/ai-fact-checks/services/aiFactChecks";
import { PERCEPTION_CLASSIFIER_VERSION } from "@/shared/ai-perception";
import type {
  AiPerceptionOpportunities,
  PerceptionOpportunity,
} from "@/shared/ai-perception-opportunities";
import type { AiIntelligenceInput } from "@/types/schemas/ai-visibility-intelligence";
import { AiPerceptionRepository as repo } from "../repositories/AiPerceptionRepository";
import { populationFor, readingIndex } from "./aiPerceptionView";
import { loadPerceptionSources } from "./aiPerceptionSources";
import { outcomeOf } from "./perceptionMetrics";
import {
  perceptionOpportunities,
  type OpportunityAnswer,
} from "./perceptionOpportunityRules";

export async function loadPerceptionOpportunities(
  input: AiIntelligenceInput,
): Promise<AiPerceptionOpportunities> {
  const selected = await selectIntelRuns(input);
  const facts = applyFilters(
    await AiIntelligenceRepository.getFacts(
      selected.selectedRuns.map((r) => r.id),
    ),
    input,
  );
  const population = populationFor(input, selected, facts);
  const own = facts.flatMap((f) => f.brands).find((b) => b.own);
  if (!own) {
    return {
      population,
      brand: null,
      opportunities: [],
      notes: ["No brand of yours is tracked, so there is nothing to compare."],
    };
  }
  const answered = facts.filter(
    (f) => isAnswered(f) && f.brands.some((b) => b.domain === own.domain),
  );
  const [index, stored, sourceData] = await Promise.all([
    readingIndex(selected.selectedRuns.map((r) => r.id)),
    repo.listForObservations(
      answered.map((f) => f.id),
      PERCEPTION_CLASSIFIER_VERSION,
    ),
    loadPerceptionSources({ ...input, brand: own.domain }),
  ]);
  const ownReadings = new Map(
    stored
      .filter((p) => p.domain === own.domain)
      .map((p) => [p.observationId, p]),
  );
  const rivalDomains = unique(
    facts.flatMap((f) => f.brands.filter((b) => !b.own)).map((b) => b.domain),
  );
  const answers: OpportunityAnswer[] = answered.map((f) => {
    const reading = ownReadings.get(f.id);
    return {
      observationId: f.id,
      engine: f.engine,
      prompt: f.prompt,
      topic: f.topic,
      outcome: outcomeOf(f, own.domain, index) ?? "missing",
      evidence: reading?.evidence ?? null,
      preferred: (reading?.comparisons ?? [])
        .filter((c) => c.outcome === "not_preferred")
        .map((c) => c.competitorName),
      recommendedRivals: f.brands
        .filter(
          (b) =>
            !b.own &&
            rivalDomains.includes(b.domain) &&
            outcomeOf(f, b.domain, index) === "recommended",
        )
        .map((b) => b.name),
    };
  });
  const newest = sort(selected.selectedRuns, (a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const report = newest
    ? await factCheckReport({ projectId: input.projectId, runId: newest.id })
    : null;
  const promptOf = new Map(answered.map((f) => [f.id, f.prompt]));
  const opportunities = perceptionOpportunities({
    brand: own.name,
    answers,
    themes: sourceData.themes,
    sources: sourceData.sources,
    baseline: sourceData.baseline.rate,
    runs: population.runs,
    contradictions: (report?.facts ?? []).flatMap((fact) =>
      fact.contradictions.flatMap((c) =>
        c.engine
          ? [
              {
                fact: fact.statement,
                observationId: c.observationId,
                engine: c.engine,
                prompt: c.prompt ?? promptOf.get(c.observationId) ?? "",
                quote: c.quote,
              },
            ]
          : [],
      ),
    ),
  });
  return {
    population,
    brand: { name: own.name, domain: own.domain },
    opportunities,
    notes: [
      "Each finding is counted from saved answers. The suggested remedy is a hypothesis; none of it has been tested.",
      ...(stored.length
        ? []
        : [
            "No answers have been read yet, so only findings that need no reading are listed.",
          ]),
    ],
  };
}

function candidateOf(
  opportunity: PerceptionOpportunity,
  population: AiPerceptionOpportunities["population"],
  now: string,
): OpportunityCandidate {
  return {
    dedupeKey: `ai_perception::${opportunity.id}`,
    query: opportunity.buyerQuestions[0] ?? opportunity.title,
    pageUrl: null,
    action: opportunity.action,
    reason: `${opportunity.title}. ${opportunity.observed}`,
    matchedCollectionHandle: null,
    dataSource: "ai_visibility",
    intent: null,
    priority: opportunity.priority,
    priorityReason: `${opportunity.answers.numerator} of ${opportunity.answers.denominator} answers that track the brand. Confidence ${opportunity.confidence}.`,
    observedAt: now,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    position: 0,
    windowStart: population.window.start,
    windowEnd: population.window.end,
    evidence: [
      {
        source: "ai_visibility",
        label: "Observed",
        value: opportunity.observed,
      },
      {
        source: "ai_visibility",
        label: "Inferred, not tested",
        value: opportunity.inferred,
      },
      ...opportunity.buyerQuestions.slice(0, 8).map((value) => ({
        source: "ai_visibility",
        label: "Buyer question",
        value,
      })),
      ...opportunity.evidence.slice(0, 8).flatMap((e) =>
        e.quote
          ? [
              {
                source: "ai_visibility",
                label: `Quoted from ${e.engine}`,
                value: e.quote,
                observedAt: population.window.end,
              },
            ]
          : [],
      ),
      {
        source: "ai_visibility",
        label: "Measurement caveat",
        value:
          "Counts come from saved answers read by a small model. Changing a page does not guarantee a different answer.",
      },
    ],
  };
}

/** Recomputes the finding from saved answers, then stores it as an opportunity. */
export async function savePerceptionOpportunity(
  scope: { projectId: string; organizationId: string },
  input: AiIntelligenceInput & { opportunityId: string },
): Promise<{ opportunityId: string } | null> {
  const result = await loadPerceptionOpportunities(input);
  const found = result.opportunities.find((o) => o.id === input.opportunityId);
  if (!found) return null;
  const opportunityId = await OpportunityRepository.upsertCandidate(
    scope,
    candidateOf(found, result.population, new Date().toISOString()),
  );
  return { opportunityId };
}
