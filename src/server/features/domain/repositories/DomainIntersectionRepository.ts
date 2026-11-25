import { and, desc, eq, inArray } from "drizzle-orm";
import { chunk, sortBy } from "remeda";
import { db } from "@/db";
import {
  aiMatches,
  aiObservations,
  aiPrompts,
  aiRuns,
  aiSources,
  aiTrackers,
  rankCheckRuns,
  rankSnapshots,
  rankTrackingConfigs,
  rankTrackingKeywords,
} from "@/db/schema";

// D1 allows about 100 bound parameters per statement.
const IN_CHUNK = 50;
// Runs of one prompt set, newest first. A prompt is answered once per engine
// per run, so a few runs cover every engine the tracker has used lately.
const RECENT_RUNS = 4;

type TrackedAnswer = {
  promptId: string;
  promptText: string;
  topic: string;
  intent: string | null;
  engine: (typeof aiObservations.$inferSelect)["engine"];
  collectedAt: string | null;
  locationCode: number;
  matches: Array<{
    domain: string;
    own: boolean;
    mentioned: boolean;
    cited: boolean;
    recommended: boolean | null;
  }>;
  sources: Array<{ url: string; domain: string }>;
};

/**
 * The newest completed answer for each active prompt and engine, from the
 * tracker's recent runs in this market. Reads stored rows only.
 */
async function latestTrackedAnswers(
  projectId: string,
  locationCode: number,
  languageCode: string,
): Promise<TrackedAnswer[]> {
  const runs = await db
    .select({ id: aiRuns.id })
    .from(aiRuns)
    .where(
      and(
        eq(aiRuns.projectId, projectId),
        eq(aiRuns.locationCode, locationCode),
        eq(aiRuns.languageCode, languageCode),
        inArray(aiRuns.status, ["completed", "partial"]),
      ),
    )
    .orderBy(desc(aiRuns.createdAt))
    .limit(RECENT_RUNS);
  if (runs.length === 0) return [];

  const observations = await db
    .select({
      id: aiObservations.id,
      promptId: aiObservations.promptId,
      engine: aiObservations.engine,
      collectedAt: aiObservations.collectedAt,
      promptText: aiPrompts.text,
      topic: aiPrompts.topic,
      intent: aiPrompts.intent,
      runId: aiObservations.runId,
    })
    .from(aiObservations)
    .innerJoin(aiPrompts, eq(aiPrompts.id, aiObservations.promptId))
    .innerJoin(aiTrackers, eq(aiTrackers.id, aiPrompts.trackerId))
    .where(
      and(
        eq(aiTrackers.projectId, projectId),
        eq(aiPrompts.archived, false),
        eq(aiObservations.status, "completed"),
        inArray(
          aiObservations.runId,
          runs.map((run) => run.id),
        ),
      ),
    );

  // Runs are newest first, so the first sighting of a prompt and engine wins.
  const runOrder = new Map(runs.map((run, index) => [run.id, index]));
  const newest = new Map<string, (typeof observations)[number]>();
  for (const row of sortBy(
    observations,
    (item) => runOrder.get(item.runId) ?? 0,
  )) {
    const key = `${row.promptId}:${row.engine}`;
    if (!newest.has(key)) newest.set(key, row);
  }
  const picked = [...newest.values()];
  const ids = picked.map((row) => row.id);

  const matchRows = (
    await Promise.all(
      chunk(ids, IN_CHUNK).map((part) =>
        db
          .select()
          .from(aiMatches)
          .where(inArray(aiMatches.observationId, part)),
      ),
    )
  ).flat();
  const sourceRows = (
    await Promise.all(
      chunk(ids, IN_CHUNK).map((part) =>
        db
          .select()
          .from(aiSources)
          .where(inArray(aiSources.observationId, part)),
      ),
    )
  ).flat();

  return picked.map((row) => ({
    promptId: row.promptId,
    promptText: row.promptText,
    topic: row.topic,
    intent: row.intent,
    engine: row.engine,
    collectedAt: row.collectedAt,
    locationCode,
    matches: matchRows
      .filter((m) => m.observationId === row.id)
      .map((m) => ({
        domain: m.domain,
        own: m.own,
        mentioned: m.mentioned,
        cited: m.cited,
        recommended: m.recommended,
      })),
    sources: sourceRows
      .filter((s) => s.observationId === row.id)
      .map((s) => ({ url: s.url, domain: s.domain })),
  }));
}

type TrackedRank = {
  keyword: string;
  position: number | null;
  url: string | null;
  device: "desktop" | "mobile";
  checkedAt: string;
  depth: number;
  locationCode: number;
};

/**
 * The newest completed rank check for each tracked keyword of the project's
 * rank tracker in this market. Desktop wins when both devices were read.
 */
async function latestTrackedRanks(
  projectId: string,
  domain: string,
  locationCode: number,
  languageCode: string,
): Promise<TrackedRank[]> {
  const [config] = await db
    .select()
    .from(rankTrackingConfigs)
    .where(
      and(
        eq(rankTrackingConfigs.projectId, projectId),
        eq(rankTrackingConfigs.domain, domain),
        eq(rankTrackingConfigs.locationCode, locationCode),
        eq(rankTrackingConfigs.languageCode, languageCode),
      ),
    )
    .limit(1);
  if (!config) return [];

  const keywords = await db
    .select({ id: rankTrackingKeywords.id })
    .from(rankTrackingKeywords)
    .where(eq(rankTrackingKeywords.configId, config.id));
  if (keywords.length === 0) return [];

  const snapshots = (
    await Promise.all(
      chunk(
        keywords.map((k) => k.id),
        IN_CHUNK,
      ).map((part) =>
        db
          .select({
            keyword: rankSnapshots.keyword,
            trackingKeywordId: rankSnapshots.trackingKeywordId,
            position: rankSnapshots.position,
            url: rankSnapshots.url,
            device: rankSnapshots.device,
            checkedAt: rankSnapshots.checkedAt,
          })
          .from(rankSnapshots)
          .innerJoin(rankCheckRuns, eq(rankCheckRuns.id, rankSnapshots.runId))
          .where(
            and(
              eq(rankCheckRuns.configId, config.id),
              eq(rankCheckRuns.status, "completed"),
              inArray(rankSnapshots.trackingKeywordId, part),
            ),
          )
          .orderBy(desc(rankSnapshots.checkedAt)),
      ),
    )
  ).flat();

  const byKeyword = new Map<string, (typeof snapshots)[number]>();
  for (const snap of snapshots) {
    const current = byKeyword.get(snap.trackingKeywordId);
    // Newest first, so only a desktop reading of the same moment displaces it.
    if (
      !current ||
      (snap.device === "desktop" &&
        current.device !== "desktop" &&
        snap.checkedAt === current.checkedAt)
    ) {
      byKeyword.set(snap.trackingKeywordId, snap);
    }
  }
  return [...byKeyword.values()].map((snap) => ({
    keyword: snap.keyword,
    position: snap.position,
    url: snap.url,
    device: snap.device,
    checkedAt: snap.checkedAt,
    depth: config.serpDepth,
    locationCode,
  }));
}

export const DomainIntersectionRepository = {
  latestTrackedAnswers,
  latestTrackedRanks,
};
