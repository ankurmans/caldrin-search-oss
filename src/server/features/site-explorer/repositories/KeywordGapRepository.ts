/* eslint-disable max-lines -- keyword gap runs, rows, decisions, competitors and saved views share one set of tables */
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  keywordGapDecisions,
  keywordGapPositions,
  keywordGapRows,
  keywordGapRunCompetitors,
  keywordGapRuns,
  projectCompetitorMarkets,
  projectCompetitors,
  savedTableViews,
} from "@/db/schema";
import type {
  KeywordGapQuery,
  GapSortField,
} from "@/types/schemas/keyword-gap";
import type { ContextAuthor } from "@/types/schemas/projectContext";
import type { GapPosition, MergedGapRow } from "../rules/gapMerge";

// D1 caps bound parameters per statement, so multi-row writes are chunked.
const ROWS_PER_INSERT = 5;
const POSITIONS_PER_INSERT = 15;
const ID_CHUNK = 90;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

type RunRecord = typeof keywordGapRuns.$inferSelect;

export type RunCompetitorRecord = {
  competitorDomain: string;
  kind: "missing" | "outranked";
  status: "ok" | "failed";
  rowsRead: number;
  providerTotal: number | null;
  error: string | null;
};

async function saveRun(input: {
  run: Omit<RunRecord, "createdAt" | "rowCount">;
  competitors: RunCompetitorRecord[];
  rows: MergedGapRow[];
  analysedDomains: string[];
  analysedAt: string;
}): Promise<void> {
  const { run, competitors, rows } = input;
  const rowIds = rows.map(() => crypto.randomUUID());
  await runBatch((tx) => [
    tx.insert(keywordGapRuns).values({ ...run, rowCount: rows.length }),
    ...chunk(competitors, 10).map((part) =>
      tx
        .insert(keywordGapRunCompetitors)
        .values(part.map((competitor) => ({ runId: run.id, ...competitor }))),
    ),
    ...chunk(rows, ROWS_PER_INSERT).map((part, partIndex) =>
      tx.insert(keywordGapRows).values(
        part.map((row, i) => {
          const { positions: _positions, ...fields } = row;
          return {
            ...fields,
            id: rowIds[partIndex * ROWS_PER_INSERT + i] ?? crypto.randomUUID(),
            runId: run.id,
            projectId: run.projectId,
          };
        }),
      ),
    ),
    ...chunk(
      rows.flatMap((row, index) =>
        row.positions.map((position) => ({
          rowId: rowIds[index] ?? "",
          ...position,
        })),
      ),
      POSITIONS_PER_INSERT,
    ).map((part) => tx.insert(keywordGapPositions).values(part)),
    ...(input.analysedDomains.length === 0
      ? []
      : [
          tx
            .update(projectCompetitors)
            .set({ lastAnalysedAt: input.analysedAt })
            .where(
              and(
                eq(projectCompetitors.projectId, run.projectId),
                inArray(projectCompetitors.domain, input.analysedDomains),
              ),
            ),
        ]),
  ]);
}

async function latestRun(
  projectId: string,
  market?: { locationCode: number; languageCode: string },
): Promise<RunRecord | null> {
  const [row] = await db
    .select()
    .from(keywordGapRuns)
    .where(
      and(
        eq(keywordGapRuns.projectId, projectId),
        market
          ? and(
              eq(keywordGapRuns.locationCode, market.locationCode),
              eq(keywordGapRuns.languageCode, market.languageCode),
            )
          : undefined,
      ),
    )
    .orderBy(desc(keywordGapRuns.createdAt))
    .limit(1);
  return row ?? null;
}

async function getRun(
  projectId: string,
  runId: string,
): Promise<RunRecord | null> {
  const [row] = await db
    .select()
    .from(keywordGapRuns)
    .where(
      and(
        eq(keywordGapRuns.projectId, projectId),
        eq(keywordGapRuns.id, runId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function listRuns(projectId: string, limit: number) {
  return db
    .select()
    .from(keywordGapRuns)
    .where(eq(keywordGapRuns.projectId, projectId))
    .orderBy(desc(keywordGapRuns.createdAt))
    .limit(limit);
}

async function runCompetitors(runId: string): Promise<RunCompetitorRecord[]> {
  return db
    .select({
      competitorDomain: keywordGapRunCompetitors.competitorDomain,
      kind: keywordGapRunCompetitors.kind,
      status: keywordGapRunCompetitors.status,
      rowsRead: keywordGapRunCompetitors.rowsRead,
      providerTotal: keywordGapRunCompetitors.providerTotal,
      error: keywordGapRunCompetitors.error,
    })
    .from(keywordGapRunCompetitors)
    .where(eq(keywordGapRunCompetitors.runId, runId))
    .orderBy(asc(keywordGapRunCompetitors.competitorDomain));
}

// `%` and `_` in a search box are literal characters.
function likePattern(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const sortColumns: Record<GapSortField, AnyColumn> = {
  searchVolume: keywordGapRows.searchVolume,
  keywordDifficulty: keywordGapRows.keywordDifficulty,
  bestPosition: keywordGapRows.bestPosition,
  targetPosition: keywordGapRows.targetPosition,
  competitorCount: keywordGapRows.competitorCount,
  keyword: keywordGapRows.keyword,
  observedAt: keywordGapRows.observedAt,
};

function filterConditions(
  projectId: string,
  run: RunRecord,
  query: Omit<KeywordGapQuery, "page" | "pageSize" | "sortBy" | "sortDir">,
) {
  const conditions = [
    eq(keywordGapRows.projectId, projectId),
    eq(keywordGapRows.runId, run.id),
  ];
  if (query.search)
    conditions.push(
      sql`${keywordGapRows.keyword} like ${likePattern(query.search)} escape '\\'`,
    );
  if (query.kind !== "all")
    conditions.push(eq(keywordGapRows.kind, query.kind));
  if (query.intent) conditions.push(eq(keywordGapRows.intent, query.intent));
  if (query.minVolume !== undefined)
    conditions.push(gte(keywordGapRows.searchVolume, query.minVolume));
  if (query.maxVolume !== undefined)
    conditions.push(lte(keywordGapRows.searchVolume, query.maxVolume));
  if (query.minKd !== undefined)
    conditions.push(gte(keywordGapRows.keywordDifficulty, query.minKd));
  if (query.maxKd !== undefined)
    conditions.push(lte(keywordGapRows.keywordDifficulty, query.maxKd));
  if (query.minPosition !== undefined)
    conditions.push(gte(keywordGapRows.bestPosition, query.minPosition));
  if (query.maxPosition !== undefined)
    conditions.push(lte(keywordGapRows.bestPosition, query.maxPosition));
  if (query.minCompetitors !== undefined)
    conditions.push(gte(keywordGapRows.competitorCount, query.minCompetitors));
  if (query.competitor) {
    conditions.push(
      sql`exists (select 1 from ${keywordGapPositions} where ${keywordGapPositions.rowId} = ${keywordGapRows.id} and ${keywordGapPositions.competitorDomain} = ${query.competitor.toLowerCase()})`,
    );
  }
  if (query.status === "open")
    conditions.push(
      or(
        isNull(keywordGapDecisions.status),
        ne(keywordGapDecisions.status, "dismissed"),
      ) ?? sql`1 = 1`,
    );
  else if (query.status !== "all")
    conditions.push(eq(keywordGapDecisions.status, query.status));
  if (query.hasOpportunity === true)
    conditions.push(isNotNull(keywordGapDecisions.opportunityId));
  if (query.hasOpportunity === false)
    conditions.push(isNull(keywordGapDecisions.opportunityId));
  return and(...conditions);
}

export type GapRowRecord = {
  id: string;
  keyword: string;
  kind: "missing" | "outranked";
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  intent: string | null;
  competitorCount: number;
  bestPosition: number;
  bestDomain: string;
  bestUrl: string | null;
  bestTraffic: number | null;
  targetPosition: number | null;
  targetUrl: string | null;
  observedAt: string;
  status: "active" | "watching" | "dismissed";
  targetPageUrl: string | null;
  opportunityId: string | null;
  positions: GapPosition[];
};

const rowSelect = {
  id: keywordGapRows.id,
  keyword: keywordGapRows.keyword,
  kind: keywordGapRows.kind,
  searchVolume: keywordGapRows.searchVolume,
  keywordDifficulty: keywordGapRows.keywordDifficulty,
  cpc: keywordGapRows.cpc,
  intent: keywordGapRows.intent,
  competitorCount: keywordGapRows.competitorCount,
  bestPosition: keywordGapRows.bestPosition,
  bestDomain: keywordGapRows.bestDomain,
  bestUrl: keywordGapRows.bestUrl,
  bestTraffic: keywordGapRows.bestTraffic,
  targetPosition: keywordGapRows.targetPosition,
  targetUrl: keywordGapRows.targetUrl,
  observedAt: keywordGapRows.observedAt,
  status: keywordGapDecisions.status,
  targetPageUrl: keywordGapDecisions.targetPageUrl,
  opportunityId: keywordGapDecisions.opportunityId,
};

function decisionJoin(run: RunRecord) {
  return and(
    eq(keywordGapDecisions.projectId, keywordGapRows.projectId),
    eq(keywordGapDecisions.keyword, keywordGapRows.keyword),
    eq(keywordGapDecisions.locationCode, run.locationCode),
    eq(keywordGapDecisions.languageCode, run.languageCode),
  );
}

async function withPositions(
  rows: Array<
    Omit<GapRowRecord, "positions" | "status"> & {
      status: GapRowRecord["status"] | null;
    }
  >,
): Promise<GapRowRecord[]> {
  const positions = new Map<string, GapPosition[]>();
  for (const ids of chunk(
    rows.map((row) => row.id),
    ID_CHUNK,
  )) {
    const found = await db
      .select()
      .from(keywordGapPositions)
      .where(inArray(keywordGapPositions.rowId, ids))
      .orderBy(asc(keywordGapPositions.position));
    for (const { rowId, ...position } of found) {
      positions.set(rowId, [...(positions.get(rowId) ?? []), position]);
    }
  }
  return rows.map((row) => ({
    ...row,
    status: row.status ?? "active",
    positions: positions.get(row.id) ?? [],
  }));
}

async function listRows(
  projectId: string,
  run: RunRecord,
  query: KeywordGapQuery,
): Promise<{ rows: GapRowRecord[]; total: number }> {
  const where = filterConditions(projectId, run, query);
  const column = sortColumns[query.sortBy];
  const direction = query.sortDir === "asc" ? asc : desc;
  const [rows, [counted]] = await Promise.all([
    db
      .select(rowSelect)
      .from(keywordGapRows)
      .leftJoin(keywordGapDecisions, decisionJoin(run))
      .where(where)
      // Missing values sort last in either direction on both backends.
      .orderBy(
        sql`${column} is null`,
        direction(column),
        asc(keywordGapRows.keyword),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ total: sql<number>`count(*)` })
      .from(keywordGapRows)
      .leftJoin(keywordGapDecisions, decisionJoin(run))
      .where(where),
  ]);
  return {
    rows: await withPositions(rows),
    total: Number(counted?.total ?? 0),
  };
}

// Up to `limit` rows for an export, in the table's sort order.
async function exportRows(
  projectId: string,
  run: RunRecord,
  query: KeywordGapQuery,
  limit: number,
): Promise<GapRowRecord[]> {
  const column = sortColumns[query.sortBy];
  const direction = query.sortDir === "asc" ? asc : desc;
  const rows = await db
    .select(rowSelect)
    .from(keywordGapRows)
    .leftJoin(keywordGapDecisions, decisionJoin(run))
    .where(filterConditions(projectId, run, query))
    .orderBy(
      sql`${column} is null`,
      direction(column),
      asc(keywordGapRows.keyword),
    )
    .limit(limit);
  return withPositions(rows);
}

async function getRowsByIds(
  projectId: string,
  run: RunRecord,
  ids: string[],
): Promise<GapRowRecord[]> {
  const found: GapRowRecord[] = [];
  for (const part of chunk(ids, ID_CHUNK)) {
    const rows = await db
      .select(rowSelect)
      .from(keywordGapRows)
      .leftJoin(keywordGapDecisions, decisionJoin(run))
      .where(
        and(
          eq(keywordGapRows.projectId, projectId),
          eq(keywordGapRows.runId, run.id),
          inArray(keywordGapRows.id, part),
        ),
      );
    found.push(...(await withPositions(rows)));
  }
  return found;
}

async function setDecision(input: {
  projectId: string;
  keywords: string[];
  locationCode: number;
  languageCode: string;
  patch: {
    status?: "active" | "watching" | "dismissed";
    targetPageUrl?: string | null;
    opportunityId?: string | null;
  };
  updatedBy: ContextAuthor;
}): Promise<void> {
  const updatedAt = new Date().toISOString();
  const set = { ...input.patch, updatedAt, updatedBy: input.updatedBy };
  await runBatch((tx) =>
    chunk(input.keywords, 10).map((part) =>
      tx
        .insert(keywordGapDecisions)
        .values(
          part.map((keyword) => ({
            projectId: input.projectId,
            keyword,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
            ...set,
          })),
        )
        .onConflictDoUpdate({
          target: [
            keywordGapDecisions.projectId,
            keywordGapDecisions.keyword,
            keywordGapDecisions.locationCode,
            keywordGapDecisions.languageCode,
          ],
          set,
        }),
    ),
  );
}

async function listCompetitorsWithMarkets(projectId: string) {
  const [competitors, markets] = await Promise.all([
    db
      .select()
      .from(projectCompetitors)
      .where(eq(projectCompetitors.projectId, projectId))
      .orderBy(asc(projectCompetitors.domain)),
    db
      .select({
        competitorId: projectCompetitorMarkets.competitorId,
        locationCode: projectCompetitorMarkets.locationCode,
        languageCode: projectCompetitorMarkets.languageCode,
      })
      .from(projectCompetitorMarkets)
      .innerJoin(
        projectCompetitors,
        eq(projectCompetitors.id, projectCompetitorMarkets.competitorId),
      )
      .where(eq(projectCompetitors.projectId, projectId)),
  ]);
  return competitors.map((competitor) => ({
    ...competitor,
    markets: markets
      .filter((market) => market.competitorId === competitor.id)
      .map(({ locationCode, languageCode }) => ({
        locationCode,
        languageCode,
      })),
  }));
}

async function setCompetitorMarkets(
  projectId: string,
  domain: string,
  markets: Array<{ locationCode: number; languageCode: string }>,
): Promise<boolean> {
  const [competitor] = await db
    .select({ id: projectCompetitors.id })
    .from(projectCompetitors)
    .where(
      and(
        eq(projectCompetitors.projectId, projectId),
        eq(projectCompetitors.domain, domain),
      ),
    )
    .limit(1);
  if (!competitor) return false;
  await runBatch((tx) => [
    tx
      .delete(projectCompetitorMarkets)
      .where(eq(projectCompetitorMarkets.competitorId, competitor.id)),
    ...(markets.length === 0
      ? []
      : [
          tx
            .insert(projectCompetitorMarkets)
            .values(
              markets.map((market) => ({
                competitorId: competitor.id,
                ...market,
              })),
            )
            .onConflictDoNothing(),
        ]),
  ]);
  return true;
}

async function markDiscovered(projectId: string, domains: string[]) {
  if (domains.length === 0) return;
  await db
    .update(projectCompetitors)
    .set({ source: "discovered" })
    .where(
      and(
        eq(projectCompetitors.projectId, projectId),
        inArray(projectCompetitors.domain, domains),
      ),
    );
}

async function listViews(projectId: string, tableKey: string) {
  return db
    .select()
    .from(savedTableViews)
    .where(
      and(
        eq(savedTableViews.projectId, projectId),
        eq(savedTableViews.tableKey, tableKey),
      ),
    )
    .orderBy(asc(savedTableViews.name));
}

async function saveView(input: {
  projectId: string;
  tableKey: string;
  name: string;
  config: string;
}) {
  await db
    .insert(savedTableViews)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoUpdate({
      target: [
        savedTableViews.projectId,
        savedTableViews.tableKey,
        savedTableViews.name,
      ],
      set: { config: input.config },
    });
}

async function deleteView(projectId: string, id: string) {
  await db
    .delete(savedTableViews)
    .where(
      and(eq(savedTableViews.projectId, projectId), eq(savedTableViews.id, id)),
    );
}

export const KeywordGapRepository = {
  saveRun,
  latestRun,
  getRun,
  listRuns,
  runCompetitors,
  listRows,
  exportRows,
  getRowsByIds,
  setDecision,
  listCompetitorsWithMarkets,
  setCompetitorMarkets,
  markDiscovered,
  listViews,
  saveView,
  deleteView,
};
