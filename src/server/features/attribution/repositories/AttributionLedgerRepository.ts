import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  attributionEventIdentifiers,
  attributionEvents,
  attributionImportBatches,
  attributionIngestCounters,
  attributionPending,
  attributionRejections,
} from "@/db/schema";

export type EventRow = typeof attributionEvents.$inferSelect;
export type NewEvent = typeof attributionEvents.$inferInsert;
import { AttributionConfigRepository } from "./AttributionConfigRepository";

type EventIdentifier = { identifierType: string; value: string };

// Twenty bound values a row on the widest tables stays under D1's limit of 100.
const IN_CHUNK = 90;

const one = async <T>(rows: Promise<T[]>) => (await rows)[0] ?? null;

const insertBatch = (row: typeof attributionImportBatches.$inferInsert) =>
  db.insert(attributionImportBatches).values(row).onConflictDoNothing();

const demoBatchIds = async (projectId: string) =>
  new Set(
    (
      await db
        .select({ id: attributionImportBatches.id })
        .from(attributionImportBatches)
        .where(
          and(
            eq(attributionImportBatches.projectId, projectId),
            eq(attributionImportBatches.isDemo, true),
          ),
        )
    ).map((r) => r.id),
  );

const listBatchesByIds = (ids: string[]) =>
  ids.length
    ? db
        .select()
        .from(attributionImportBatches)
        .where(inArray(attributionImportBatches.id, ids))
    : Promise.resolve([]);

/** Deletes every demo batch and the events it brought; real batches are untouched. */
async function deleteDemoData(projectId: string) {
  const ids = [...(await demoBatchIds(projectId))];
  for (const part of chunk(ids, 90))
    await db
      .delete(attributionEvents)
      .where(inArray(attributionEvents.importBatchId, part));
  await db
    .delete(attributionImportBatches)
    .where(
      and(
        eq(attributionImportBatches.projectId, projectId),
        eq(attributionImportBatches.isDemo, true),
      ),
    );
  return ids.length;
}

const addBatchCounts = (
  id: string,
  counts: { accepted: number; duplicate: number; rejected: number },
) =>
  db
    .update(attributionImportBatches)
    .set({
      acceptedCount: sql`${attributionImportBatches.acceptedCount} + ${counts.accepted}`,
      duplicateCount: sql`${attributionImportBatches.duplicateCount} + ${counts.duplicate}`,
      rejectedCount: sql`${attributionImportBatches.rejectedCount} + ${counts.rejected}`,
      receivedCount: sql`${attributionImportBatches.receivedCount} + ${counts.accepted + counts.duplicate + counts.rejected}`,
    })
    .where(eq(attributionImportBatches.id, id));

/** Source ids already in the ledger, so a repeated delivery is counted as a duplicate. */
async function findExistingSourceIds(
  projectId: string,
  sourceSystem: string,
  sourceEventIds: string[],
) {
  const found = new Set<string>();
  for (const ids of chunk(sourceEventIds, IN_CHUNK)) {
    const rows = await db
      .select({ id: attributionEvents.sourceEventId })
      .from(attributionEvents)
      .where(
        and(
          eq(attributionEvents.projectId, projectId),
          eq(attributionEvents.sourceSystem, sourceSystem),
          inArray(attributionEvents.sourceEventId, ids),
        ),
      );
    for (const row of rows) found.add(row.id);
  }
  return found;
}

/**
 * Writes events, the identifiers they carried and their place in the
 * processing queue in one atomic step per chunk. A source id that is already
 * in the ledger is skipped by the unique index even if two requests race.
 */
async function insertEvents(
  rows: { event: NewEvent; identifiers: EventIdentifier[] }[],
) {
  // One statement per event keeps each under D1's 100 bound values.
  for (const part of chunk(rows, 10)) {
    await runBatch((tx) =>
      part.flatMap(({ event, identifiers }) => [
        tx.insert(attributionEvents).values(event).onConflictDoNothing(),
        ...(identifiers.length
          ? [
              tx
                .insert(attributionEventIdentifiers)
                .values(
                  identifiers.map((i) => ({
                    eventId: event.id,
                    projectId: event.projectId,
                    ...i,
                  })),
                )
                .onConflictDoNothing(),
            ]
          : []),
        tx
          .insert(attributionPending)
          .values({
            eventId: event.id,
            projectId: event.projectId,
            position: event.ingestedAt,
          })
          .onConflictDoNothing(),
      ]),
    );
  }
}

async function addCounters(
  projectId: string,
  day: string,
  counts: { accepted: number; rejected: number },
) {
  await db
    .insert(attributionIngestCounters)
    .values({ projectId, day, ...counts })
    .onConflictDoUpdate({
      target: [
        attributionIngestCounters.projectId,
        attributionIngestCounters.day,
      ],
      set: {
        accepted: sql`${attributionIngestCounters.accepted} + ${counts.accepted}`,
        rejected: sql`${attributionIngestCounters.rejected} + ${counts.rejected}`,
      },
    });
}

const getCounter = (projectId: string, day: string) =>
  one(
    db
      .select()
      .from(attributionIngestCounters)
      .where(
        and(
          eq(attributionIngestCounters.projectId, projectId),
          eq(attributionIngestCounters.day, day),
        ),
      )
      .limit(1),
  );

async function insertRejections(
  rows: (typeof attributionRejections.$inferInsert)[],
) {
  for (const values of chunk(rows, 12))
    await db.insert(attributionRejections).values(values);
}

const pruneRejections = (before: string) =>
  db
    .delete(attributionRejections)
    .where(lt(attributionRejections.createdAt, before));

const getEvents = async (ids: string[]) => {
  const rows: EventRow[] = [];
  for (const part of chunk(ids, IN_CHUNK))
    rows.push(
      ...(await db
        .select()
        .from(attributionEvents)
        .where(inArray(attributionEvents.id, part))),
    );
  return rows;
};

const identifiersOf = async (eventIds: string[]) => {
  const rows: { eventId: string; identifierType: string; value: string }[] = [];
  for (const part of chunk(eventIds, IN_CHUNK))
    rows.push(
      ...(await db
        .select({
          eventId: attributionEventIdentifiers.eventId,
          identifierType: attributionEventIdentifiers.identifierType,
          value: attributionEventIdentifiers.value,
        })
        .from(attributionEventIdentifiers)
        .where(inArray(attributionEventIdentifiers.eventId, part))),
    );
  return rows;
};

const listPending = (projectId: string, limit: number) =>
  db
    .select()
    .from(attributionPending)
    .where(eq(attributionPending.projectId, projectId))
    .orderBy(asc(attributionPending.position), asc(attributionPending.eventId))
    .limit(limit);

const clearPending = async (eventIds: string[]) => {
  for (const part of chunk(eventIds, IN_CHUNK))
    await db
      .delete(attributionPending)
      .where(inArray(attributionPending.eventId, part));
};

const countPending = async (projectId: string) =>
  Number(
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(attributionPending)
        .where(eq(attributionPending.projectId, projectId))
    )[0]?.n ?? 0,
  );

const projectsWithPending = async () =>
  (
    await db
      .selectDistinct({ projectId: attributionPending.projectId })
      .from(attributionPending)
      .limit(50)
  ).map((r) => r.projectId);

/** Queues every event in the project again, in ingestion order. */
const queueAllEvents = (projectId: string) =>
  db
    .insert(attributionPending)
    .select(
      db
        .select({
          eventId: attributionEvents.id,
          projectId: attributionEvents.projectId,
          position: attributionEvents.ingestedAt,
        })
        .from(attributionEvents)
        .where(eq(attributionEvents.projectId, projectId)),
    )
    .onConflictDoNothing();

const sinceCounts = async (projectId: string, since: string) =>
  db
    .select({
      eventType: attributionEvents.eventType,
      n: sql<number>`count(*)`,
    })
    .from(attributionEvents)
    .where(
      and(
        eq(attributionEvents.projectId, projectId),
        gte(attributionEvents.occurredAt, since),
        eq(attributionEvents.isTest, false),
        eq(attributionEvents.isBot, false),
      ),
    )
    .groupBy(attributionEvents.eventType);

/** The latest events for the install check, newest first. */
const recentEvents = (projectId: string, limit: number) =>
  db
    .select({
      id: attributionEvents.id,
      eventType: attributionEvents.eventType,
      sourceSystem: attributionEvents.sourceSystem,
      origin: attributionEvents.origin,
      occurredAt: attributionEvents.occurredAt,
      ingestedAt: attributionEvents.ingestedAt,
      landingHost: attributionEvents.landingHost,
      pagePath: attributionEvents.pagePath,
      isTest: attributionEvents.isTest,
      isBot: attributionEvents.isBot,
    })
    .from(attributionEvents)
    .where(eq(attributionEvents.projectId, projectId))
    .orderBy(desc(attributionEvents.ingestedAt))
    .limit(limit);

const pruneEvents = (projectId: string, eventType: string, before: string) =>
  db
    .delete(attributionEvents)
    .where(
      and(
        eq(attributionEvents.projectId, projectId),
        eq(attributionEvents.eventType, eventType),
        lt(attributionEvents.occurredAt, before),
      ),
    );

export const AttributionLedgerRepository = {
  ...AttributionConfigRepository,
  insertBatch,
  addBatchCounts,
  listBatchesByIds,
  demoBatchIds,
  deleteDemoData,
  findExistingSourceIds,
  insertEvents,
  addCounters,
  getCounter,
  insertRejections,
  pruneRejections,
  getEvents,
  identifiersOf,
  listPending,
  clearPending,
  countPending,
  projectsWithPending,
  queueAllEvents,
  sinceCounts,
  pruneEvents,
  recentEvents,
};
