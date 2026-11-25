import { and, asc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { localRankTrackers, projects } from "@/db/schema";

type LocalTrackerRow = typeof localRankTrackers.$inferSelect;

export async function setSchedule(
  projectId: string,
  trackerId: string,
  schedule: Pick<
    LocalTrackerRow,
    "scheduleInterval" | "nextCheckAt" | "lastSkipReason"
  >,
) {
  await db
    .update(localRankTrackers)
    .set(schedule)
    .where(
      and(
        eq(localRankTrackers.projectId, projectId),
        eq(localRankTrackers.id, trackerId),
      ),
    );
}

/** Oldest due first; archived projects are skipped. */
export const listDueTrackers = (now: string) =>
  db
    .select({
      tracker: localRankTrackers,
      organizationId: projects.organizationId,
    })
    .from(localRankTrackers)
    .innerJoin(projects, eq(projects.id, localRankTrackers.projectId))
    .where(
      and(
        isNotNull(localRankTrackers.scheduleInterval),
        lte(localRankTrackers.nextCheckAt, now),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(localRankTrackers.nextCheckAt))
    .limit(25);

/** True when this caller moved the schedule on, so two ticks never both start. */
export async function claimDueTracker(
  trackerId: string,
  observedNextCheckAt: string,
  nextCheckAt: string,
) {
  const claimed = await db
    .update(localRankTrackers)
    .set({ nextCheckAt, lastSkipReason: null })
    .where(
      and(
        eq(localRankTrackers.id, trackerId),
        eq(localRankTrackers.nextCheckAt, observedNextCheckAt),
      ),
    )
    .returning({ id: localRankTrackers.id });
  return claimed.length > 0;
}
