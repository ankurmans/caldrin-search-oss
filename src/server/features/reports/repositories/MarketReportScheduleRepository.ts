import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  marketReportSchedules as schedules,
  marketReportScheduleMarkets as markets,
  projects,
} from "@/db/schema";

type Schedule = typeof schedules.$inferInsert;
type Market = { locationCode: number; languageCode: string };
const owner = (projectId: string, userId: string) =>
  and(eq(schedules.projectId, projectId), eq(schedules.userId, userId));

async function get(projectId: string, userId: string) {
  const [schedule] = await db
    .select()
    .from(schedules)
    .where(owner(projectId, userId))
    .limit(1);
  if (!schedule) return null;
  return { ...schedule, markets: await listMarkets(schedule.id) };
}

function listMarkets(scheduleId: string) {
  return db
    .select({
      locationCode: markets.locationCode,
      languageCode: markets.languageCode,
    })
    .from(markets)
    .where(eq(markets.scheduleId, scheduleId))
    .orderBy(markets.locationCode, markets.languageCode);
}

async function save(schedule: Schedule, selection: Market[]) {
  const id = schedule.id;
  await runBatch((tx) => [
    tx
      .insert(schedules)
      .values(schedule)
      .onConflictDoUpdate({
        target: [schedules.projectId, schedules.userId],
        set: {
          cadence: schedule.cadence,
          days: schedule.days,
          nextRunAt: schedule.nextRunAt,
        },
      }),
    tx.delete(markets).where(eq(markets.scheduleId, id)),
    tx
      .insert(markets)
      .values(selection.map((market) => ({ scheduleId: id, ...market }))),
  ]);
}

function clear(projectId: string, userId: string) {
  return db.delete(schedules).where(owner(projectId, userId));
}

function due(now: string) {
  return db
    .select({
      schedule: schedules,
      organizationId: projects.organizationId,
    })
    .from(schedules)
    .innerJoin(projects, eq(projects.id, schedules.projectId))
    .where(and(lte(schedules.nextRunAt, now), isNull(projects.archivedAt)))
    .orderBy(schedules.nextRunAt)
    .limit(25);
}

async function claim(id: string, expected: string, next: string) {
  const [claimed] = await db
    .update(schedules)
    .set({ nextRunAt: next, lastStatus: "Preparing report" })
    .where(and(eq(schedules.id, id), eq(schedules.nextRunAt, expected)))
    .returning({ id: schedules.id });
  return Boolean(claimed);
}

function finish(
  id: string,
  expected: string,
  lastStatus: string,
  lastReportId?: string,
) {
  return db
    .update(schedules)
    .set({ lastStatus, lastReportId })
    .where(and(eq(schedules.id, id), eq(schedules.nextRunAt, expected)));
}

export const MarketReportScheduleRepository = {
  get,
  save,
  clear,
  listMarkets,
  due,
  claim,
  finish,
};
