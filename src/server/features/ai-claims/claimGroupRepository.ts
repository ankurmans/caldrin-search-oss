import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  aiClaims as claims,
  aiClaimGroupHistory as groupHistory,
} from "@/db/schema";

export const claimGroupRepository = {
  groupCandidates: (claim: typeof claims.$inferSelect) =>
    db
      .select()
      .from(claims)
      .where(
        and(
          eq(claims.projectId, claim.projectId),
          eq(claims.subject, claim.subject),
          eq(claims.category, claim.category),
          isNull(claims.mergedInto),
          lt(claims.id, claim.id),
        ),
      )
      .limit(100),
  groupHistory: (projectId: string, id: string) =>
    db
      .select()
      .from(groupHistory)
      .where(
        and(
          eq(groupHistory.projectId, projectId),
          eq(groupHistory.claimId, id),
        ),
      )
      .orderBy(desc(groupHistory.createdAt))
      .limit(30),
  group: async (
    claim: typeof claims.$inferSelect,
    target: string | null,
    actorId: string,
  ) => {
    const eventId = crypto.randomUUID();
    const eligible = and(
      eq(claims.projectId, claim.projectId),
      eq(claims.id, claim.id),
      claim.mergedInto
        ? eq(claims.mergedInto, claim.mergedInto)
        : isNull(claims.mergedInto),
      target
        ? and(
            isNull(claims.mergedInto),
            sql`exists (select 1 from ai_claims as target where target.project_id = ${claim.projectId} and target.id = ${target} and target.merged_into is null)`,
            sql`not exists (select 1 from ai_claims as child where child.project_id = ${claim.projectId} and child.merged_into = ${claim.id})`,
          )
        : undefined,
    );
    await runBatch((tx) => [
      tx
        .update(claims)
        .set({ mergedInto: sql`${claims.mergedInto}` })
        .where(eq(claims.id, claim.id)),
      tx.insert(groupHistory).select(
        tx
          .select({
            id: sql<string>`${eventId}`.as("id"),
            projectId: claims.projectId,
            claimId: claims.id,
            previousTarget: claims.mergedInto,
            target: sql<string | null>`${target}`.as("target"),
            actorId: sql<string>`${actorId}`.as("actor_id"),
            createdAt: sql<string>`${new Date().toISOString()}`.as(
              "created_at",
            ),
          })
          .from(claims)
          .where(eligible),
      ),
      tx
        .update(claims)
        .set({ mergedInto: target })
        .where(
          and(
            eq(claims.id, claim.id),
            sql`exists(select 1 from ${groupHistory} where ${groupHistory.id} = ${eventId})`,
          ),
        ),
    ]);
    return (
      (
        await db
          .select({ id: groupHistory.id })
          .from(groupHistory)
          .where(eq(groupHistory.id, eventId))
      ).length > 0
    );
  },
};
