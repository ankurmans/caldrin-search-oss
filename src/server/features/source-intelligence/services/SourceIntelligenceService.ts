import { FanOutRepository } from "../repositories/FanOutRepository";
import { aiMarketLabel } from "@/shared/ai-visibility";
import { engineLabel } from "@/types/schemas/source-intelligence";
import { ownsEditorialUrl } from "@/shared/editorialUrl";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { loadSourceAnalysis } from "./sourceAnalysisRead";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import type {
  SourceFilters,
  SourceQuery,
} from "@/types/schemas/source-intelligence";
import {
  SourceIntelligenceRepository as repo,
  type SourceAppearance,
} from "../repositories/SourceIntelligenceRepository";
import {
  sourceCandidate,
  SourceActionRefusal,
  type SourceActionKind,
} from "../rules/sourceOpportunity";
import {
  coverageNotes,
  mergeCounts,
  pageOf,
  type SourceRow,
} from "../rules/sourceRules";

type Scope = { projectId: string; organizationId: string };

const ownership = (row: SourceRow) =>
  row.brand ?? (row.sourceClass === "unknown" ? "unknown" : "third_party");

/** Stored answers only: no provider is called from here. */
export async function loadSourceIntelligence(input: SourceQuery) {
  const { projectId, filters, view } = input;
  const [coverage, brands, decisions, promptGroups, markets, project] =
    await Promise.all([
      repo.coverage(projectId, filters),
      repo.brands(projectId),
      repo.listDecisions(projectId),
      repo.promptGroups(projectId),
      FanOutRepository.markets(projectId),
      ProjectRepository.getProjectById(projectId),
    ]);
  const decisionOf = new Map(decisions.map((d) => [d.domain, d.decision]));
  const paging = {
    view,
    sortBy: input.sortBy,
    sortDir: input.sortDir,
    page: input.page,
    pageSize: input.pageSize,
  };
  const base = {
    filters,
    coverage,
    notes: coverageNotes(coverage),
    brands: brands
      .filter((b) => !b.own)
      .map((b) => ({ name: b.name, domain: b.domain })),
    promptGroups,
    markets,
    answers: coverage.reduce((sum, c) => sum + c.answers, 0),
  };
  const emptyBreakdown = { own: 0, competitor: 0, third_party: 0, unknown: 0 };
  if (view === "queries") {
    const rows = await repo.queryRows(projectId, filters);
    const page = pageOf(rows, paging);
    return {
      ...base,
      view,
      total: page.total,
      queryRows: page.rows,
      rows: [],
      breakdown: emptyBreakdown,
    };
  }
  const by = view === "domains" ? "domain" : "url";
  const [cited, retrieved] = await Promise.all([
    repo.citedCounts(projectId, filters, by),
    repo.retrievedCounts(projectId, filters, by),
  ]);
  const projectBrands = project?.domain
    ? [{ own: true, name: project.name, domain: project.domain }, ...brands]
    : brands;
  const merged = mergeCounts(cited, retrieved, projectBrands)
    .map((row) => ({ ...row, decision: decisionOf.get(row.domain) ?? null }))
    .filter((row) => !(filters.hideDismissed && row.decision === "dismiss"));
  const appearance = filters.appearance ?? "cited";
  const observed = merged.filter((row) =>
    appearance === "cited" ? row.citedAnswers > 0 : row.retrievedAnswers > 0,
  );
  const breakdown = { ...emptyBreakdown };
  for (const row of observed) breakdown[ownership(row)] += 1;
  const page = pageOf(
    (filters.appearance ? observed : merged).filter(
      (row) => !filters.ownership || ownership(row) === filters.ownership,
    ),
    paging,
  );
  return {
    ...base,
    view,
    total: page.total,
    rows: page.rows,
    queryRows: [],
    breakdown,
  };
}

/** One page with every answer that cited or retrieved it. */
export async function loadSourceDetail(
  projectId: string,
  filters: SourceFilters,
  url: string,
): Promise<{ row: SourceRow | null; appearances: SourceAppearance[] }> {
  const [cited, retrieved, brands, appearances] = await Promise.all([
    repo.citedCounts(projectId, filters, "url"),
    repo.retrievedCounts(projectId, filters, "url"),
    repo.brands(projectId),
    repo.appearances(projectId, filters, url),
  ]);
  const row =
    mergeCounts(
      cited.filter((c) => c.key === url),
      retrieved.filter((c) => c.key === url),
      brands,
    )[0] ?? null;
  return { row, appearances };
}

/** Recomputes the page from stored answers, then stores it as an opportunity. */
export async function createSourceOpportunity(
  scope: Scope,
  input: {
    filters: SourceFilters;
    url: string;
    action: SourceActionKind;
  },
): Promise<{ opportunityId: string }> {
  const { row, appearances } = await loadSourceDetail(
    scope.projectId,
    input.filters,
    input.url,
  );
  if (!row)
    throw new SourceActionRefusal(
      "This page is not in the answers for these filters any more. Reload and try again.",
    );
  const analysis = await loadSourceAnalysis(scope.projectId, input.url);
  const opportunityId = await OpportunityRepository.upsertCandidate(
    scope,
    sourceCandidate({
      row,
      appearances,
      action: input.action,
      now: new Date().toISOString(),
      reading: analysis && {
        analysedAt: analysis.analysedAt,
        pageKind: analysis.pageKind,
        approach: analysis.approach,
        summary: analysis.summary,
        namesBrand: analysis.namesBrand,
        competitors: analysis.items
          .filter((i) => i.kind === "competitor_named")
          .map((i) => i.text),
        questions: analysis.items
          .filter((i) => i.kind === "buyer_question")
          .map((i) => i.text),
        datedFacts: analysis.items
          .filter((i) => i.kind === "dated_fact")
          .map((i) => i.text),
      },
    }),
  );
  return { opportunityId };
}

export async function decideSource(input: {
  projectId: string;
  domain: string;
  decision: "monitor" | "dismiss" | "clear";
  userId: string;
}) {
  await repo.setDecision({ ...input, domain: input.domain.toLowerCase() });
}

export { SourceActionRefusal };

export async function loadFanOutQueryExport(
  input: Pick<SourceQuery, "projectId" | "filters" | "sortBy" | "sortDir">,
) {
  const rows = await repo.queryRows(input.projectId, input.filters);
  return pageOf(rows, {
    ...input,
    view: "queries",
    page: 1,
    pageSize: rows.length,
  }).rows;
}

export async function loadFanOutPrompts(
  projectId: string,
  filters: SourceFilters,
  page: number,
  pageSize: number,
) {
  const rows = await FanOutRepository.promptObservations(projectId, filters);
  const start = (page - 1) * pageSize;
  return { total: rows.length, rows: rows.slice(start, start + pageSize) };
}

export function loadFanOutAnswers(
  projectId: string,
  filters: SourceFilters,
  page: number,
) {
  return FanOutRepository.fanOutAnswerRows(
    projectId,
    filters,
    20,
    (page - 1) * 20,
  );
}

export function loadFanOutAnswer(projectId: string, observationId: string) {
  return FanOutRepository.fanOutAnswer(projectId, observationId);
}

export async function saveFanOutOpportunity(
  scope: Scope,
  observationId: string,
  pageUrl?: string,
) {
  const answer = await FanOutRepository.fanOutAnswer(
    scope.projectId,
    observationId,
  );
  if (!answer)
    throw new SourceActionRefusal(
      "This answer is unavailable in this project.",
    );
  const project = await ProjectRepository.getProjectById(scope.projectId);
  if (pageUrl && !ownsEditorialUrl(project?.domain, pageUrl)) {
    throw new SourceActionRefusal(
      "Choose a landing page on this project's website.",
    );
  }
  const date = answer.collectedAt ?? new Date().toISOString();
  const evidenceLink = `/p/${scope.projectId}/ai-visibility/sources?${new URLSearchParams(
    {
      view: "queries",
      answer: answer.id,
      promptId: answer.promptId,
      locationCode: String(answer.locationCode),
      languageCode: answer.languageCode,
    },
  )}`;
  const opportunityId = await OpportunityRepository.upsertCandidate(scope, {
    dedupeKey: `fan_out::${observationId}::${pageUrl ?? ""}`,
    query: answer.prompt,
    pageUrl: pageUrl ?? null,
    action: pageUrl ? "refresh_existing_page" : "create_page",
    reason:
      "Review the buyer question and saved answer before choosing what to cover.",
    matchedCollectionHandle: null,
    dataSource: "ai_visibility",
    intent: null,
    priority: "low",
    priorityReason: "Selected for editorial review.",
    observedAt: date,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    position: 0,
    windowStart: date,
    windowEnd: date,
    evidence: [
      {
        source: "ai_visibility",
        label: "Saved answer",
        value: `${engineLabel(answer.engine)} · ${aiMarketLabel(answer)}`,
        url: evidenceLink,
        observedAt: answer.collectedAt,
      },
      ...answer.queries.slice(0, 20).map((value) => ({
        source: "ai_visibility",
        label: "Reported search",
        value,
        observedAt: answer.collectedAt,
      })),
      ...answer.cited.slice(0, 10).map((page) => ({
        source: "ai_visibility",
        label: "Cited page",
        value: page.title ?? page.url,
        url: page.url,
        observedAt: answer.collectedAt,
      })),
    ],
  });
  return { opportunityId };
}
