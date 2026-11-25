import { AiIntelligenceRepository } from "@/server/features/ai-visibility/repositories/aiIntelligenceRepository";
import { AiMeasurementRepository } from "@/server/features/ai-visibility/repositories/aiMeasurementRepository";
import { isAnswered } from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";
import { CitationGapRepository } from "@/server/features/citation-gaps/citationGapRepository";
import { isOnDomain } from "@/server/features/citation-gaps/citationSourceRules";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import type { SourceGapAnalysis, SourceGapSummary } from "@/shared/source-gap";
import type {
  SourceGapAnalyzeInput,
  SourceGapPromptInput,
} from "@/types/schemas/source-gap";
import { resolveOwner } from "./ownerResolution";
import { entitiesOn, entityVocabulary } from "./pageSignals";
import { topicOverview } from "./sourceGapTopics";
import { describeChanges } from "./sourceGapChanges";
import { diagnose } from "./sourceGapDiagnosis";
import { buildDifferences } from "./sourceGapDifferences";
import {
  brandsOf,
  collectionModeOf,
  promptStats,
  summarizeCitedSources,
} from "./sourceGapEvidence";
import {
  actionableRecommendations,
  sourceGapCandidate,
} from "./sourceGapOpportunity";
import {
  SourceGapRepository,
  type StoredAnalysis,
} from "./sourceGapRepository";
import {
  hydrate,
  MAX_SOURCES_FETCHED,
  mergeCanonical,
  skipped,
  stripped,
} from "./sourceGapStore";
import { createRobotsGate } from "./sourcePageFetcher";
import { getSnapshot } from "./sourceSnapshotService";
import { isFileUrl, isHomepageUrl } from "./sourceUrl";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;
const MAX_RUNS = 120;
const FETCH_CONCURRENCY = 4;

export class SourceGapRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceGapRefusal";
  }
}

async function inBatches<T, R>(
  items: T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

export async function getLatestAnalysis(
  input: SourceGapPromptInput,
): Promise<SourceGapAnalysis | null> {
  const row = await SourceGapRepository.latestAnalysis(
    input.projectId,
    input.promptId,
  );
  return row ? hydrate(input.projectId, row) : null;
}

export async function listAnalysisSummaries(
  projectId: string,
): Promise<SourceGapSummary[]> {
  const rows = await SourceGapRepository.latestAnalysisPerPrompt(projectId);
  return rows.map((r) => ({
    id: r.id,
    promptId: r.promptId,
    createdAt: r.createdAt,
    topRootCause:
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- column holds a RootCauseCategory
      (r.topRootCause as
        | SourceGapAnalysis["rootCauses"][number]["category"]
        | null) ?? null,
    ownerUrl: r.ownerUrl,
    ownerConfidence: r.ownerConfidence,
    sourcesAnalyzed: r.sourcesAnalyzed,
    opportunityId: r.opportunityId,
  }));
}

/**
 * Analyzes one tracked prompt from answers already stored. No AI query runs.
 * Cited pages and the project's own candidate pages are fetched once and kept
 * as snapshots, and an analysis never replaces an earlier one.
 */
export async function analyzePrompt(
  scope: { projectId: string; organizationId: string },
  input: SourceGapAnalyzeInput,
  now: Date = new Date(),
): Promise<SourceGapAnalysis> {
  const { projectId } = scope;
  const prompt = await SourceGapRepository.getPrompt(projectId, input.promptId);
  if (!prompt)
    throw new SourceGapRefusal("That prompt is not in this project.");
  const project = await OpportunityRepository.getProjectBrand(projectId);
  const nowIso = now.toISOString();

  const runs = await AiMeasurementRepository.listFinishedRuns(
    projectId,
    { from: new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString() },
    MAX_RUNS,
  );
  const runIds = runs.map((r) => r.id);
  const allFacts = await AiIntelligenceRepository.getFacts(runIds);
  const facts = allFacts.filter((f) => f.promptId === prompt.id);
  const answered = facts.filter(isAnswered);
  if (answered.length === 0)
    throw new SourceGapRefusal(
      "This prompt has no stored answers in the last 90 days. Run a visibility check first.",
    );
  const usedRunIds = [...new Set(answered.map((f) => f.runId))];
  const cited = (
    await CitationGapRepository.listCitedSources(usedRunIds)
  ).filter((c) => answered.some((f) => f.id === c.observationId));
  const brands = brandsOf(facts);
  const own = brands.find((b) => b.own);
  const ownDomain = project?.domain ?? own?.domain ?? "";
  const stats = promptStats(facts);

  const robots = createRobotsGate();
  const deps = { robots };
  const fetchSnapshot = (url: string, forceRefresh?: boolean) =>
    getSnapshot({
      projectId,
      url,
      forceRefresh: forceRefresh ?? input.forceRefresh,
      now,
      deps,
    });

  // Cited pages, most-cited first; the project's own cited pages are context,
  // so they are read last and only if there is room.
  let sources = summarizeCitedSources(answered, cited, brands);
  const order = [
    ...sources.filter((s) => s.sourceType !== "own"),
    ...sources.filter((s) => s.sourceType === "own"),
  ];
  // Files, front pages and robots.txt-blocked pages cost no page request, so
  // they are always recorded and do not use up the page limit.
  const costed = await inBatches(order, FETCH_CONCURRENCY, async (s) => ({
    source: s,
    free:
      isFileUrl(s.url) ||
      isHomepageUrl(s.url) ||
      !(await robots.allowed(s.url)),
  }));
  const toFetch = [
    ...costed.filter((c) => c.free).map((c) => c.source),
    ...costed
      .filter((c) => !c.free)
      .map((c) => c.source)
      .slice(0, MAX_SOURCES_FETCHED),
  ];
  const fetched = await inBatches(toFetch, FETCH_CONCURRENCY, async (s) => ({
    key: s.url,
    snapshot: await fetchSnapshot(s.url),
  }));
  const snapshots = new Map(fetched.map((f) => [f.key, f.snapshot]));
  for (const source of sources)
    source.snapshot =
      snapshots.get(source.url) ?? skipped(source.url, source.url, nowIso);
  sources = mergeCanonical(sources);

  const competitorNames = brands.filter((b) => !b.own).map((b) => b.name);
  const ownNames = own
    ? [own.name, own.domain.replace(/^www\./, "").split(".")[0]].filter(
        (n): n is string => !!n && n.length > 1,
      )
    : [];
  for (const source of sources) {
    const page = source.snapshot?.page;
    if (!page) continue;
    source.brandsOnPage = entitiesOn(page, competitorNames);
    source.ownOnPage = entitiesOn(page, ownNames).length > 0;
  }

  const { selection, ownerSnapshot } = await resolveOwner({
    projectId,
    prompt,
    ownDomain,
    override: await SourceGapRepository.getOwnerOverride(projectId, prompt.id),
    retryUrls: input.retryUrl ? [input.retryUrl] : [],
    sources,
    fetchSnapshot,
  });
  const ownerPage = ownerSnapshot?.page ?? null;

  const diffInput = {
    prompt: prompt.text,
    now,
    owner: ownerPage,
    sources,
    vocabulary: entityVocabulary(
      brands.map((b) => b.name),
      prompt.text,
    ),
    ownBrandNames: ownNames,
    competitorNames,
  };
  const diagnosis = diagnose({
    ...diffInput,
    intent: prompt.intent,
    runCount: usedRunIds.length,
    selection,
    stats,
  });

  const analysis: SourceGapAnalysis = {
    id: crypto.randomUUID(),
    projectId,
    promptId: prompt.id,
    prompt: prompt.text,
    topic: prompt.topic,
    intent: prompt.intent,
    runIds: usedRunIds,
    createdAt: nowIso,
    collectionMode: collectionModeOf(stats.engines.map((e) => e.engine)),
    stats,
    owner: selection,
    ownerSnapshot,
    sources,
    differences: buildDifferences(diffInput),
    consensus: diagnosis.consensus,
    rootCauses: diagnosis.rootCauses,
    recommendations: diagnosis.recommendations,
    measurementNotes: diagnosis.notes,
    opportunityId: null,
    changes: [],
    previousAnalysisId: null,
  };

  const previousRow = await SourceGapRepository.latestAnalysis(
    projectId,
    prompt.id,
  );
  if (previousRow) {
    const previous = await hydrate(projectId, previousRow);
    analysis.previousAnalysisId = previous.id;
    analysis.opportunityId = previous.opportunityId;
    analysis.changes = describeChanges(previous, analysis);
  }

  await SourceGapRepository.insertAnalysis({
    id: analysis.id,
    projectId,
    promptId: prompt.id,
    createdAt: nowIso,
    previousAnalysisId: analysis.previousAnalysisId,
    ownerUrl: selection.selected?.url ?? null,
    ownerConfidence: selection.confidence,
    ownerOverridden: selection.overridden,
    topRootCause: analysis.rootCauses[0]?.category ?? null,
    sourcesAnalyzed: sources.filter((s) => s.snapshot?.status === "ok").length,
    collectionMode: analysis.collectionMode,
    opportunityId: analysis.opportunityId,
    resultJson: JSON.stringify(stripped(analysis)),
  });
  return analysis;
}

/** Remembers the page a person chose for a prompt; null goes back to automatic. */
export async function setOwnerPage(
  input: SourceGapPromptInput & { ownerUrl: string | null },
): Promise<void> {
  const prompt = await SourceGapRepository.getPrompt(
    input.projectId,
    input.promptId,
  );
  if (!prompt)
    throw new SourceGapRefusal("That prompt is not in this project.");
  const domain = (await OpportunityRepository.getProjectBrand(input.projectId))
    ?.domain;
  if (input.ownerUrl && domain) {
    const host = new URL(input.ownerUrl).hostname;
    if (!isOnDomain(host, domain))
      throw new SourceGapRefusal(`The owner page has to be on ${domain}.`);
  }
  await SourceGapRepository.setOwnerOverride(
    input.projectId,
    input.promptId,
    input.ownerUrl,
    new Date().toISOString(),
  );
}

/** Stores the analysis as a Search Opportunity, keeping its evidence chain. */
export async function createSourceGapOpportunity(
  scope: { projectId: string; organizationId: string },
  input: { analysisId: string },
): Promise<{ opportunityId: string }> {
  const row = await SourceGapRepository.getAnalysis(
    scope.projectId,
    input.analysisId,
  );
  if (!row) throw new OpportunityRefusal("That analysis no longer exists.");
  const analysis = await hydrate(scope.projectId, row);
  if (actionableRecommendations(analysis).length === 0)
    throw new OpportunityRefusal(
      "This analysis found nothing to change on the page. Collect more runs and analyze again.",
    );
  const opportunityId = await OpportunityRepository.upsertCandidate(
    scope,
    sourceGapCandidate(analysis, new Date().toISOString()),
  );
  await SourceGapRepository.setAnalysisOpportunity(
    scope.projectId,
    analysis.id,
    opportunityId,
    JSON.stringify(stripped({ ...analysis, opportunityId })),
  );
  return { opportunityId };
}

/** Latest analysis of each active prompt, grouped by topic. */
export async function getTopicOverview(projectId: string) {
  const { AiVisibilityService } =
    await import("@/server/features/ai-visibility/services/AiVisibilityService");
  const tracker = await AiVisibilityService.getTracker({ projectId });
  const prompts = tracker.prompts.filter((p) => !p.archived && !p.paused);
  const latest = await SourceGapRepository.latestAnalysisPerPrompt(projectId);
  const rows = await Promise.all(
    latest.map((l) => SourceGapRepository.getAnalysis(projectId, l.id)),
  );
  const analyses = rows
    .filter((r): r is StoredAnalysis => !!r)
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stored JSON was written by this service
    .map((r) => JSON.parse(r.resultJson) as SourceGapAnalysis);
  return topicOverview(prompts, analyses);
}
