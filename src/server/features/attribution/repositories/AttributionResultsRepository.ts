import { and, asc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  attributionConversions,
  attributionCredits,
  attributionEvents,
  attributionModelRuns,
  attributionTouchpoints,
} from "@/db/schema";

type TouchpointRow = typeof attributionTouchpoints.$inferSelect;
type ConversionRow = typeof attributionConversions.$inferSelect;
type NewCredit = typeof attributionCredits.$inferInsert;

const IN_CHUNK = 90;
const ANCHOR_CHUNK = 40;
const one = async <T>(rows: Promise<T[]>) => (await rows)[0] ?? null;

const upsertTouchpoint = (row: typeof attributionTouchpoints.$inferInsert) =>
  db.insert(attributionTouchpoints).values(row).onConflictDoNothing();

/** Touchpoints anchored on any of these identity values in a time window. */
async function touchpointsFor(
  projectId: string,
  anchors: { type: string; value: string }[],
  from: string,
  to: string,
) {
  const rows: TouchpointRow[] = [];
  // Two bound values per anchor, so half the usual chunk keeps a statement
  // under D1's 100-parameter limit.
  for (const part of chunk(anchors, ANCHOR_CHUNK))
    rows.push(
      ...(await db
        .select()
        .from(attributionTouchpoints)
        .where(
          and(
            eq(attributionTouchpoints.projectId, projectId),
            // Type and value together: an id of one kind must never match a
            // touchpoint anchored on the same string as another kind.
            or(
              ...part.map((a) =>
                and(
                  eq(attributionTouchpoints.anchorType, a.type),
                  eq(attributionTouchpoints.anchorValue, a.value),
                ),
              ),
            ),
            gte(attributionTouchpoints.occurredAt, from),
            lte(attributionTouchpoints.occurredAt, to),
          ),
        )
        .orderBy(asc(attributionTouchpoints.occurredAt))
        .limit(200)),
    );
  return rows;
}

const upsertConversion = (row: typeof attributionConversions.$inferInsert) =>
  db
    .insert(attributionConversions)
    .values(row)
    .onConflictDoUpdate({
      target: attributionConversions.eventId,
      set: {
        subjectId: row.subjectId,
        amountMinor: row.amountMinor,
        grossMinor: row.grossMinor,
        isFirstPayment: row.isFirstPayment,
      },
    });

const getConversionByEvent = (eventId: string) =>
  one(
    db
      .select()
      .from(attributionConversions)
      .where(eq(attributionConversions.eventId, eventId))
      .limit(1),
  );

const getConversion = (projectId: string, id: string) =>
  one(
    db
      .select()
      .from(attributionConversions)
      .where(
        and(
          eq(attributionConversions.projectId, projectId),
          eq(attributionConversions.id, id),
        ),
      )
      .limit(1),
  );

const conversionsOfSubjects = async (
  projectId: string,
  subjectIds: string[],
) => {
  const rows: ConversionRow[] = [];
  for (const part of chunk(subjectIds, IN_CHUNK))
    rows.push(
      ...(await db
        .select()
        .from(attributionConversions)
        .where(
          and(
            eq(attributionConversions.projectId, projectId),
            inArray(attributionConversions.subjectId, part),
          ),
        )
        .orderBy(asc(attributionConversions.occurredAt))
        .limit(500)),
    );
  return rows;
};

const reassignConversions = (projectId: string, from: string, to: string) =>
  db
    .update(attributionConversions)
    .set({ subjectId: to })
    .where(
      and(
        eq(attributionConversions.projectId, projectId),
        eq(attributionConversions.subjectId, from),
      ),
    );

/** Whether the subject paid before this moment, which makes a payment a repeat. */
const hasEarlierPayment = async (
  projectId: string,
  subjectId: string,
  before: string,
  exceptEventId: string,
) =>
  Boolean(
    await one(
      db
        .select({ id: attributionConversions.id })
        .from(attributionConversions)
        .where(
          and(
            eq(attributionConversions.projectId, projectId),
            eq(attributionConversions.subjectId, subjectId),
            eq(attributionConversions.kind, "payment"),
            lt(attributionConversions.occurredAt, before),
            sql`${attributionConversions.eventId} <> ${exceptEventId}`,
          ),
        )
        .limit(1),
    ),
  );

/** Replaces the credits of these conversions, atomically per conversion. */
async function replaceCredits(
  items: { conversionId: string; credits: NewCredit[] }[],
) {
  for (const part of chunk(items, 8)) {
    await runBatch((tx) => [
      tx.delete(attributionCredits).where(
        inArray(
          attributionCredits.conversionId,
          part.map((p) => p.conversionId),
        ),
      ),
      ...part.flatMap((p) =>
        chunk(p.credits, 6).map((values) =>
          tx.insert(attributionCredits).values(values).onConflictDoNothing(),
        ),
      ),
    ]);
  }
}

const latestRun = (projectId: string) =>
  one(
    db
      .select()
      .from(attributionModelRuns)
      .where(eq(attributionModelRuns.projectId, projectId))
      .orderBy(sql`${attributionModelRuns.createdAt} desc`)
      .limit(1),
  );

const getRun = (projectId: string, id: string) =>
  one(
    db
      .select()
      .from(attributionModelRuns)
      .where(
        and(
          eq(attributionModelRuns.projectId, projectId),
          eq(attributionModelRuns.id, id),
        ),
      )
      .limit(1),
  );

const insertRun = (row: typeof attributionModelRuns.$inferInsert) =>
  db.insert(attributionModelRuns).values(row);

const creditsOf = (projectId: string, conversionId: string) =>
  db
    .select()
    .from(attributionCredits)
    .where(
      and(
        eq(attributionCredits.projectId, projectId),
        eq(attributionCredits.conversionId, conversionId),
      ),
    );

/** Net refunded amount recorded against a payment's source event id. */
const refundedFor = async (projectId: string, parentSourceEventId: string) =>
  Number(
    (
      await db
        .select({
          total: sql<number>`coalesce(sum(abs(${attributionEvents.amountMinor})), 0)`,
        })
        .from(attributionEvents)
        .where(
          and(
            eq(attributionEvents.projectId, projectId),
            eq(attributionEvents.eventType, "refund"),
            eq(attributionEvents.parentSourceEventId, parentSourceEventId),
            eq(attributionEvents.isTest, false),
          ),
        )
    )[0]?.total ?? 0,
  );

const paymentBySourceId = (projectId: string, sourceEventId: string) =>
  one(
    db
      .select({ id: attributionEvents.id })
      .from(attributionEvents)
      .where(
        and(
          eq(attributionEvents.projectId, projectId),
          eq(attributionEvents.eventType, "payment"),
          eq(attributionEvents.sourceEventId, sourceEventId),
        ),
      )
      .limit(1),
  );

/** Removes everything derived for the project; the ledger is not touched. */
async function wipeDerived(projectId: string) {
  await db
    .delete(attributionCredits)
    .where(eq(attributionCredits.projectId, projectId));
  await db
    .delete(attributionConversions)
    .where(eq(attributionConversions.projectId, projectId));
  await db
    .delete(attributionTouchpoints)
    .where(eq(attributionTouchpoints.projectId, projectId));
}

export const AttributionResultsRepository = {
  upsertTouchpoint,
  touchpointsFor,
  upsertConversion,
  getConversionByEvent,
  getConversion,
  conversionsOfSubjects,
  reassignConversions,
  hasEarlierPayment,
  replaceCredits,
  latestRun,
  getRun,
  insertRun,
  creditsOf,
  refundedFor,
  paymentBySourceId,
  wipeDerived,
};
