import { aiMarketQuery } from "@/shared/ai-market";
import { sort, unique } from "remeda";
import type {
  CitationGapAnalysis,
  CitationGapFinding,
  CitationSourceDetail,
  RankedAction,
  RankedActions,
} from "@/shared/citation-gaps";
import type {
  CitationGapInput,
  CitationSourceInput,
  CreateGapOpportunityInput,
} from "@/types/schemas/citation-gaps";
import { AiIntelligenceRepository } from "@/server/features/ai-visibility/repositories/aiIntelligenceRepository";
import { AiMeasurementRepository } from "@/server/features/ai-visibility/repositories/aiMeasurementRepository";
import { markdownToText } from "@/server/features/ai-visibility/providers/dataforseoEvidence";
import {
  intelCoverage,
  isAnswered,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { CitationGapRepository } from "./citationGapRepository";
import { detectCitationGaps } from "./citationGapRules";
import { gapCandidate } from "./gapOpportunity";
import {
  buildSourceRows,
  citedPassages,
  isOnDomain,
  normalizeDomain,
  sourceKind,
} from "./citationSourceRules";

const DAY_MS = 86_400_000;
const MAX_RUNS = 120;
const MAX_DETAIL_ANSWERS = 50;

/**
 * The finished runs of the window that measured the newest prompt set, as on
 * Visibility Insights, so both pages count the same answers.
 */
async function load(input: CitationGapInput) {
  const end = new Date();
  const start = new Date(end.getTime() - input.days * DAY_MS);
  const window = {
    start: start.toISOString(),
    end: end.toISOString(),
    days: input.days,
  };
  const runs = await AiMeasurementRepository.listFinishedRuns(
    input.projectId,
    { from: window.start, to: window.end },
    MAX_RUNS,
    aiMarketQuery(input),
  );
  const versionId = runs[0]?.promptSetVersionId ?? null;
  const selected = runs.filter((r) => r.promptSetVersionId === versionId);
  const runIds = selected.map((r) => r.id);
  const [allFacts, sources] = await Promise.all([
    AiIntelligenceRepository.getFacts(runIds),
    CitationGapRepository.listCitedSources(runIds),
  ]);
  const facts = allFacts.filter(
    (f) =>
      (!input.engines || input.engines.includes(f.engine)) &&
      (!input.topic || f.topic === input.topic),
  );
  return {
    window,
    versionId,
    runs,
    selected,
    runIds,
    allFacts,
    facts,
    sources,
  };
}

export async function analyzeCitationGaps(
  input: CitationGapInput,
): Promise<CitationGapAnalysis> {
  const { window, versionId, runs, selected, allFacts, facts, sources } =
    await load(input);
  const findings = detectCitationGaps(facts, sources);
  const existing = new Map(
    (
      await OpportunityRepository.listOpportunities(input.projectId, {
        source: "ai_visibility",
      })
    ).map((o) => [o.dedupeKey, o.id]),
  );
  for (const f of findings) f.opportunityId = existing.get(f.key) ?? null;
  const coverage = intelCoverage(facts);
  const own = facts.flatMap((f) => f.brands).find((b) => b.own);
  const notes: string[] = [];
  if (runs.length > selected.length)
    notes.push(
      `${runs.length - selected.length} run(s) in this period measured a different prompt set and are not included.`,
    );
  if (runs.length >= MAX_RUNS)
    notes.push(`Only the newest ${MAX_RUNS} runs are included.`);
  notes.push(
    "A citation shows the engine used a page. It does not mean the page endorses any brand named in the answer.",
  );
  return {
    window,
    promptSetVersionId: versionId,
    coverage: {
      runs: coverage.contributingRuns,
      answered: coverage.answered,
      planned: coverage.planned,
      prompts: coverage.prompts,
      engines: coverage.engines,
    },
    ownBrand: own ? { name: own.name || own.domain, domain: own.domain } : null,
    options: {
      engines: sort(unique(allFacts.map((f) => f.engine)), (a, b) =>
        a.localeCompare(b),
      ),
      topics: sort(unique(allFacts.map((f) => f.topic)), (a, b) =>
        a.localeCompare(b),
      ),
    },
    sources: buildSourceRows(facts, sources),
    findings,
    notes,
  };
}

export async function loadCitationSource(
  input: CitationSourceInput,
): Promise<CitationSourceDetail> {
  const { runIds, facts, sources } = await load(input);
  const domain = normalizeDomain(input.domain);
  const answered = new Map(facts.filter(isAnswered).map((f) => [f.id, f]));
  const hits = sources.filter(
    (s) => answered.has(s.observationId) && isOnDomain(s.domain, domain),
  );
  const ids = sort(unique(hits.map((h) => h.observationId)), (a, b) =>
    (answered.get(b)?.collectedAt ?? "").localeCompare(
      answered.get(a)?.collectedAt ?? "",
    ),
  );
  const shown = ids.slice(0, MAX_DETAIL_ANSWERS);
  const markdown = await CitationGapRepository.getAnswerMarkdown(runIds, shown);
  const brands = [...answered.values()].flatMap((f) => f.brands);
  return {
    domain,
    kind: sourceKind(domain, brands).kind,
    answers: shown.map((id) => {
      const fact = answered.get(id)!;
      const urls = unique(
        hits.filter((h) => h.observationId === id).map((h) => h.url),
      );
      return {
        observationId: id,
        prompt: fact.prompt,
        promptGroup: fact.topic,
        engine: fact.engine,
        collectedAt: fact.collectedAt,
        urls,
        brandsNamed: fact.brands
          .filter((b) => b.mentioned)
          .map((b) => ({ name: b.name || b.domain, own: b.own })),
        passages: citedPassages(
          markdown.get(id) ?? "",
          urls,
          domain,
          markdownToText,
        ),
      };
    }),
    truncated: ids.length > shown.length,
  };
}

/** Recomputes the finding from stored answers, then stores it as an opportunity. */
export async function createGapOpportunity(
  scope: { projectId: string; organizationId: string },
  input: CreateGapOpportunityInput,
): Promise<{ opportunityId: string; finding: CitationGapFinding }> {
  const { facts, sources } = await load(input);
  const finding = detectCitationGaps(facts, sources).find(
    (f) => f.key === input.findingKey,
  );
  if (!finding)
    throw new OpportunityRefusal(
      "This finding is no longer in the latest answers for these filters. Reload the page and try again.",
    );
  if (!finding.action)
    throw new OpportunityRefusal(
      "This finding is a note about the measurement, not an action.",
    );
  const opportunityId = await OpportunityRepository.upsertCandidate(
    scope,
    gapCandidate(finding, new Date().toISOString()),
  );
  return { opportunityId, finding: { ...finding, opportunityId } };
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const MIN_SIDE_ANSWERS = 3;

/**
 * Citation-gap findings that are actions, ordered by priority, then lowest
 * effort, then most answers behind them. For an action already stored as an
 * opportunity, shows how often answers in its prompt group named you before
 * and after the day it was stored. That is an observation; nothing links the
 * change to the work.
 */
export async function rankCitationActions(
  input: CitationGapInput,
): Promise<RankedActions> {
  const { window, facts, sources } = await load(input);
  const findings = detectCitationGaps(facts, sources);
  const stored = new Map(
    (
      await OpportunityRepository.listOpportunities(input.projectId, {
        source: "ai_visibility",
      })
    ).map((o) => [o.dedupeKey, o]),
  );
  const answered = facts.filter(isAnswered);
  const effortOrder = { low: 0, medium: 1, high: 2 } as const;
  const ranked = sort(
    findings.filter((f) => f.action),
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      effortOrder[a.effort.level] - effortOrder[b.effort.level] ||
      b.answersInGroup - a.answersInGroup ||
      a.key.localeCompare(b.key),
  );
  const actions: RankedAction[] = ranked.map((f, index) => {
    const opportunity = stored.get(f.key) ?? null;
    return {
      rank: index + 1,
      kind: f.action === "earn_third_party_coverage" ? "earned" : "owned",
      action: f.action!,
      findingKey: f.key,
      title: f.title,
      promptGroup: f.promptGroup,
      suggestedAction: f.suggestedAction,
      priority: f.priority,
      effort: f.effort,
      uncertain: f.uncertain,
      opportunityId: opportunity?.id ?? null,
      opportunityStatus: opportunity?.status ?? null,
      opportunityStoredAt: opportunity?.createdAt ?? null,
      reading: opportunity
        ? actionReading(
            answered.filter((a) => a.topic === f.promptGroup),
            opportunity.createdAt,
          )
        : null,
    };
  });
  const own = facts.flatMap((f) => f.brands).find((b) => b.own);
  return {
    window,
    ownBrand: own ? { name: own.name || own.domain, domain: own.domain } : null,
    actions,
    notes: [
      "Ranking uses the finding's priority, then lowest effort, then the number of answers behind it. It does not estimate traffic or revenue.",
      "Before and after readings are observations. Answers vary between runs, and nothing here shows the work caused a change.",
    ],
  };
}

type GroupFacts = Awaited<ReturnType<typeof load>>["facts"];

const sideReading = (list: GroupFacts) => ({
  answered: list.length,
  namingYou: list.filter((f) => f.brands.some((b) => b.own && b.mentioned))
    .length,
});

function actionReading(
  group: GroupFacts,
  storedAt: string,
): RankedAction["reading"] {
  const dated = group.filter((f) => f.collectedAt);
  const before = sideReading(dated.filter((f) => f.collectedAt! < storedAt));
  const after = sideReading(dated.filter((f) => f.collectedAt! >= storedAt));
  const thin =
    before.answered < MIN_SIDE_ANSWERS || after.answered < MIN_SIDE_ANSWERS;
  return {
    before,
    after,
    note: thin
      ? `Fewer than ${MIN_SIDE_ANSWERS} answered collections on one side, too few to compare.`
      : "Compare against the repeat-run noise before reading a change into this.",
  };
}

export { load as loadAnsweredWindow };
