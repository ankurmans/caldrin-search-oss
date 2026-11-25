import { and, eq, gte, lt, ne, sql, inArray } from "drizzle-orm";
import { chunk } from "remeda";
import {
  aiCrawlerCloudflare,
  aiCrawlerHits,
  aiCrawlerKeys,
  projects,
} from "@/db/schema";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";

// Six bound values a row; D1 allows about 100 per statement.
const HITS_PER_INSERT = 15;

const getKey = async (projectId: string) =>
  (
    await db
      .select()
      .from(aiCrawlerKeys)
      .where(eq(aiCrawlerKeys.projectId, projectId))
      .limit(1)
  )[0] ?? null;

/** The project a key belongs to, with its workspace for access checks. */
const findKey = async (keyHash: string) =>
  (
    await db
      .select({
        id: aiCrawlerKeys.id,
        projectId: aiCrawlerKeys.projectId,
        organizationId: projects.organizationId,
        lastUsedAt: aiCrawlerKeys.lastUsedAt,
      })
      .from(aiCrawlerKeys)
      .innerJoin(projects, eq(projects.id, aiCrawlerKeys.projectId))
      .where(eq(aiCrawlerKeys.keyHash, keyHash))
      .limit(1)
  )[0] ?? null;

/** One key per project: a new key replaces the old one, which stops working. */
async function replaceKey(row: typeof aiCrawlerKeys.$inferInsert) {
  await db
    .insert(aiCrawlerKeys)
    .values(row)
    .onConflictDoUpdate({
      target: aiCrawlerKeys.projectId,
      set: {
        id: row.id,
        keyHash: row.keyHash,
        prefix: row.prefix,
        createdAt: row.createdAt,
        lastUsedAt: null,
      },
    });
}

const touchKey = (id: string, at: string) =>
  db
    .update(aiCrawlerKeys)
    .set({ lastUsedAt: at })
    .where(eq(aiCrawlerKeys.id, id));

async function countPaths(projectId: string, day: string) {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${aiCrawlerHits.path})` })
    .from(aiCrawlerHits)
    .where(
      and(eq(aiCrawlerHits.projectId, projectId), eq(aiCrawlerHits.day, day)),
    );
  return Number(row?.count ?? 0);
}

async function hasPath(projectId: string, day: string, path: string) {
  const rows = await db
    .select({ path: aiCrawlerHits.path })
    .from(aiCrawlerHits)
    .where(
      and(
        eq(aiCrawlerHits.projectId, projectId),
        eq(aiCrawlerHits.day, day),
        eq(aiCrawlerHits.path, path),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

const addHits = (
  hit: Omit<typeof aiCrawlerHits.$inferInsert, "hits">,
  hits = 1,
) =>
  db
    .insert(aiCrawlerHits)
    .values({ ...hit, hits })
    .onConflictDoUpdate({
      target: [
        aiCrawlerHits.projectId,
        aiCrawlerHits.day,
        aiCrawlerHits.bot,
        aiCrawlerHits.path,
        aiCrawlerHits.statusClass,
      ],
      set: { hits: sql`${aiCrawlerHits.hits} + ${hits}` },
    });

const listHits = (projectId: string, sinceDay: string) =>
  db
    .select()
    .from(aiCrawlerHits)
    .where(
      and(
        eq(aiCrawlerHits.projectId, projectId),
        gte(aiCrawlerHits.day, sinceDay),
      ),
    );

const pruneHits = (beforeDay: string) =>
  db.delete(aiCrawlerHits).where(lt(aiCrawlerHits.day, beforeDay));

const getProjectDomain = async (projectId: string) =>
  (
    await db
      .select({ domain: projects.domain })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
  )[0]?.domain ?? null;

const getCloudflare = async (projectId: string) =>
  (
    await db
      .select()
      .from(aiCrawlerCloudflare)
      .where(eq(aiCrawlerCloudflare.projectId, projectId))
      .limit(1)
  )[0] ?? null;

/**
 * Another project in the same workspace that already connected Cloudflare,
 * among those the caller may open (null = all of them).
 */
const findWorkspaceCloudflare = async (
  projectId: string,
  allowedProjectIds: string[] | null,
) => {
  const [self] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!self) return null;
  return (
    (
      await db
        .select({
          sealedToken: aiCrawlerCloudflare.sealedToken,
          zoneName: aiCrawlerCloudflare.zoneName,
        })
        .from(aiCrawlerCloudflare)
        .innerJoin(projects, eq(projects.id, aiCrawlerCloudflare.projectId))
        .where(
          and(
            eq(projects.organizationId, self.organizationId),
            ne(aiCrawlerCloudflare.projectId, projectId),
            allowedProjectIds
              ? inArray(aiCrawlerCloudflare.projectId, allowedProjectIds)
              : undefined,
          ),
        )
        .limit(1)
    )[0] ?? null
  );
};

const listCloudflareProjectIds = async () =>
  (
    await db
      .select({ projectId: aiCrawlerCloudflare.projectId })
      .from(aiCrawlerCloudflare)
  ).map((row) => row.projectId);

const saveCloudflare = (row: typeof aiCrawlerCloudflare.$inferInsert) =>
  db
    .insert(aiCrawlerCloudflare)
    .values(row)
    .onConflictDoUpdate({
      target: aiCrawlerCloudflare.projectId,
      set: {
        sealedToken: row.sealedToken,
        zoneId: row.zoneId,
        zoneName: row.zoneName,
        lastError: null,
      },
    });

const markCloudflareSync = (
  projectId: string,
  result: { at: string; error: string | null },
) =>
  db
    .update(aiCrawlerCloudflare)
    .set({
      lastError: result.error,
      ...(result.error ? {} : { lastSyncedAt: result.at }),
    })
    .where(eq(aiCrawlerCloudflare.projectId, projectId));

const deleteCloudflare = (projectId: string) =>
  db
    .delete(aiCrawlerCloudflare)
    .where(eq(aiCrawlerCloudflare.projectId, projectId));

/**
 * Cloudflare's count for a day is the whole picture, so it replaces whatever
 * was stored for that day, including visits a Worker snippet reported.
 */
const replaceDay = (
  projectId: string,
  day: string,
  rows: Omit<typeof aiCrawlerHits.$inferInsert, "projectId" | "day">[],
) =>
  runBatch((tx) => [
    tx
      .delete(aiCrawlerHits)
      .where(
        and(eq(aiCrawlerHits.projectId, projectId), eq(aiCrawlerHits.day, day)),
      ),
    ...chunk(rows, HITS_PER_INSERT).map((part) =>
      tx
        .insert(aiCrawlerHits)
        .values(part.map((row) => ({ ...row, projectId, day }))),
    ),
  ]);

export const AiCrawlerRepository = {
  getCloudflare,
  findWorkspaceCloudflare,
  listCloudflareProjectIds,
  saveCloudflare,
  markCloudflareSync,
  deleteCloudflare,
  replaceDay,
  getProjectDomain,
  pruneHits,
  getKey,
  findKey,
  replaceKey,
  touchKey,
  countPaths,
  hasPath,
  addHits,
  listHits,
};
