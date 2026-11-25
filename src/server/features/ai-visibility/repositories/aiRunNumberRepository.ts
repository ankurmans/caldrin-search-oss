import { and, count, eq, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { aiRuns } from "@/db/schema";

/**
 * The run's 1-based position among the project's retained runs, oldest first,
 * in the order listRuns uses (created time, then id). Pruned runs no longer
 * count, so numbers can shift down once history older than 13 months goes.
 */
export async function getAiRunNumber(
  projectId: string,
  run: { id: string; createdAt: string },
) {
  const [row] = await db
    .select({ value: count() })
    .from(aiRuns)
    .where(
      and(
        eq(aiRuns.projectId, projectId),
        or(
          lt(aiRuns.createdAt, run.createdAt),
          and(eq(aiRuns.createdAt, run.createdAt), lte(aiRuns.id, run.id)),
        ),
      ),
    );
  return row?.value ?? 1;
}
