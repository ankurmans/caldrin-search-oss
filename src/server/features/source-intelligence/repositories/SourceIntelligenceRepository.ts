import { sort } from "remeda";
import { inScope, inSourceDomain } from "./sourceScope";
import {
  type AnyColumn,
  and,
  countDistinct,
  desc,
  eq,
  inArray,
  max,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  aiMatches,
  aiObservationQueries,
  aiObservationRetrievals,
  aiObservations,
  aiPrompts,
  aiRuns,
  aiSourceDecisions,
  aiSources,
  keywordMetrics,
} from "@/db/schema";
import type { SourceFilters } from "@/types/schemas/source-intelligence";
import type {
  Brand,
  CountRow,
  EngineCoverage,
  QueryRow,
} from "../rules/sourceRules";

// A project's source data is bounded by its prompts and engines, but a very
// large one is cut here rather than loaded whole.
const ROW_LIMIT = 5_000;

const toNumber = (value: unknown) => Number(value ?? 0);

async function sourceCounts(
  kind: "cited" | "retrieved",
  projectId: string,
  filters: SourceFilters,
  by: "url" | "domain",
): Promise<CountRow[]> {
  const table = kind === "cited" ? aiSources : aiObservationRetrievals;
  const key = by === "url" ? table.url : table.domain;
  const domainFilter = filters.sourceDomain
    ? eq(table.domain, filters.sourceDomain.toLowerCase())
    : undefined;
  const rows = await db
    .select({
      key,
      domain: table.domain,
      engine: aiObservations.engine,
      answers: countDistinct(table.observationId),
      title: max(table.title),
      description:
        kind === "retrieved"
          ? max(aiObservationRetrievals.description)
          : sql<null>`null`,
      lastSeen: max(aiObservations.collectedAt),
    })
    .from(table)
    .innerJoin(aiObservations, eq(aiObservations.id, table.observationId))
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .where(and(inScope(projectId, filters), domainFilter))
    .groupBy(key, table.domain, aiObservations.engine)
    .limit(ROW_LIMIT);
  return rows.map((row) => ({
    ...row,
    answers: toNumber(row.answers),
    description: row.description ?? null,
  }));
}

async function coverage(
  projectId: string,
  filters: SourceFilters,
): Promise<EngineCoverage[]> {
  const flag = (column: AnyColumn) =>
    sql<number>`sum(case when ${column} then 1 else 0 end)`;
  const rows = await db
    .select({
      engine: aiObservations.engine,
      answers: sql<number>`count(*)`,
      queriesExposed: flag(aiObservations.queriesExposed),
      retrievalExposed: flag(aiObservations.retrievalExposed),
      notCaptured: sql<number>`sum(case when ${aiObservations.queriesExposed} is null then 1 else 0 end)`,
      withCitations: sql<number>`sum(case when exists (select 1 from ${aiSources} where ${aiSources.observationId} = ${aiObservations.id}) then 1 else 0 end)`,
    })
    .from(aiObservations)
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .where(and(inScope(projectId, filters), inSourceDomain(filters)))
    .groupBy(aiObservations.engine);
  return rows.map((row) => ({
    engine: row.engine,
    answers: toNumber(row.answers),
    queriesExposed: toNumber(row.queriesExposed),
    retrievalExposed: toNumber(row.retrievalExposed),
    notCaptured: toNumber(row.notCaptured),
    withCitations: toNumber(row.withCitations),
  }));
}

async function queryRows(
  projectId: string,
  filters: SourceFilters,
  terms?: string[],
): Promise<QueryRow[]> {
  const key = sql<string>`lower(trim(${aiObservationQueries.query}))`;
  const metricMatch =
    filters.locationCode && filters.languageCode
      ? and(
          eq(keywordMetrics.projectId, projectId),
          eq(keywordMetrics.keyword, key),
          eq(keywordMetrics.locationCode, filters.locationCode),
          eq(keywordMetrics.languageCode, filters.languageCode),
        )
      : sql`false`;
  const scope = and(
    inScope(projectId, filters),
    inSourceDomain(filters),
    terms ? inArray(key, terms) : undefined,
  );
  const rows = await db
    .select({
      query: key,
      answers: countDistinct(aiObservationQueries.observationId),
      prompts: countDistinct(aiObservations.promptId),
      lastSeen: max(aiObservations.collectedAt),
      searchVolume: max(keywordMetrics.searchVolume),
      keywordDifficulty: max(keywordMetrics.keywordDifficulty),
      metricsFetchedAt: max(keywordMetrics.fetchedAt),
    })
    .from(aiObservationQueries)
    .innerJoin(
      aiObservations,
      eq(aiObservations.id, aiObservationQueries.observationId),
    )
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .leftJoin(keywordMetrics, metricMatch)
    .where(scope)
    .groupBy(key)
    .orderBy(desc(countDistinct(aiObservationQueries.observationId)), key)
    .limit(ROW_LIMIT);
  const result = await db
    .select({ query: key, engine: aiObservations.engine })
    .from(aiObservationQueries)
    .innerJoin(
      aiObservations,
      eq(aiObservations.id, aiObservationQueries.observationId),
    )
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .where(scope)
    .groupBy(key, aiObservations.engine);
  const engines = new Map<string, string[]>();
  for (const row of result) {
    const current = engines.get(row.query) ?? [];
    current.push(row.engine);
    engines.set(row.query, current);
  }
  return rows.map((row) => ({
    ...row,
    engines: sort(engines.get(row.query) ?? [], (a, b) => a.localeCompare(b)),
  }));
}

/** Tracked brands seen in the project's answers, used to flag source domains. */
async function brands(projectId: string): Promise<Brand[]> {
  const rows = await db
    .selectDistinct({
      domain: aiMatches.domain,
      name: aiMatches.name,
      own: aiMatches.own,
    })
    .from(aiMatches)
    .innerJoin(aiObservations, eq(aiObservations.id, aiMatches.observationId))
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .where(eq(aiRuns.projectId, projectId));
  return rows;
}

async function promptGroups(projectId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ topic: aiPrompts.topic })
    .from(aiPrompts)
    .innerJoin(aiObservations, eq(aiObservations.promptId, aiPrompts.id))
    .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
    .where(eq(aiRuns.projectId, projectId));
  const topics = rows.map((row) => row.topic);
  topics.sort();
  return topics;
}

export type SourceAppearance = {
  observationId: string;
  promptId: string;
  prompt: string;
  engine: string;
  collectedAt: string | null;
  cited: boolean;
  retrieved: boolean;
  queries: string[];
};

/** Every answer in scope that cited or retrieved one page, with its searches. */
async function appearances(
  projectId: string,
  filters: SourceFilters,
  url: string,
): Promise<SourceAppearance[]> {
  const [cited, retrieved] = await Promise.all([
    db
      .select({ id: aiSources.observationId })
      .from(aiSources)
      .innerJoin(aiObservations, eq(aiObservations.id, aiSources.observationId))
      .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
      .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
      .where(and(inScope(projectId, filters), eq(aiSources.url, url))),
    db
      .select({ id: aiObservationRetrievals.observationId })
      .from(aiObservationRetrievals)
      .innerJoin(
        aiObservations,
        eq(aiObservations.id, aiObservationRetrievals.observationId),
      )
      .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
      .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
      .where(
        and(inScope(projectId, filters), eq(aiObservationRetrievals.url, url)),
      ),
  ]);
  const citedIds = new Set(cited.map((row) => row.id));
  const retrievedIds = new Set(retrieved.map((row) => row.id));
  // D1 binds at most 100 parameters, so the detail shows the 90 latest answers.
  const ids = [...new Set([...citedIds, ...retrievedIds])].slice(0, 90);
  if (ids.length === 0) return [];
  const [answers, queries] = await Promise.all([
    db
      .select({
        observationId: aiObservations.id,
        promptId: aiObservations.promptId,
        prompt: aiPrompts.text,
        engine: aiObservations.engine,
        collectedAt: aiObservations.collectedAt,
      })
      .from(aiObservations)
      .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
      .where(inArray(aiObservations.id, ids))
      .orderBy(desc(aiObservations.collectedAt)),
    db
      .select({
        observationId: aiObservationQueries.observationId,
        query: aiObservationQueries.query,
      })
      .from(aiObservationQueries)
      .where(inArray(aiObservationQueries.observationId, ids)),
  ]);
  return answers.map((answer) => ({
    ...answer,
    cited: citedIds.has(answer.observationId),
    retrieved: retrievedIds.has(answer.observationId),
    queries: queries
      .filter((q) => q.observationId === answer.observationId)
      .map((q) => q.query),
  }));
}

async function listDecisions(projectId: string) {
  return db
    .select({
      domain: aiSourceDecisions.domain,
      decision: aiSourceDecisions.decision,
    })
    .from(aiSourceDecisions)
    .where(eq(aiSourceDecisions.projectId, projectId));
}

async function setDecision(input: {
  projectId: string;
  domain: string;
  decision: "monitor" | "dismiss" | "clear";
  userId: string;
}) {
  if (input.decision === "clear") {
    await db
      .delete(aiSourceDecisions)
      .where(
        and(
          eq(aiSourceDecisions.projectId, input.projectId),
          eq(aiSourceDecisions.domain, input.domain),
        ),
      );
    return;
  }
  const values = {
    decision: input.decision,
    decidedAt: new Date().toISOString(),
    decidedBy: input.userId,
  };
  await db
    .insert(aiSourceDecisions)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      domain: input.domain,
      ...values,
    })
    .onConflictDoUpdate({
      target: [aiSourceDecisions.projectId, aiSourceDecisions.domain],
      set: values,
    });
}

export const SourceIntelligenceRepository = {
  citedCounts: (
    projectId: string,
    filters: SourceFilters,
    by: "url" | "domain",
  ) => sourceCounts("cited", projectId, filters, by),
  retrievedCounts: (
    projectId: string,
    filters: SourceFilters,
    by: "url" | "domain",
  ) => sourceCounts("retrieved", projectId, filters, by),
  coverage,
  queryRows,
  brands,
  promptGroups,
  appearances,
  listDecisions,
  setDecision,
};
