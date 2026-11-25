import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  gte,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  aiClaimJobs as jobs,
  aiClaimExtractions as items,
  aiClaims as claims,
  aiClaimOccurrences as occurrences,
  aiObservations,
  aiRuns,
  member,
  projects,
  walletRun,
} from "@/db/schema";

export type ClaimJob = typeof jobs.$inferSelect;
export type ClaimItem = typeof items.$inferSelect;

export const claimJobRepository = {
  jobExists: async (id: string) =>
    (
      await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.id, id))
        .limit(1)
    ).length > 0,
  unsettledHostedJobs: () =>
    db
      .select({ job: jobs })
      .from(jobs)
      .innerJoin(walletRun, sql`${walletRun.runId} = ('claim:' || ${jobs.id})`)
      .where(
        and(
          isNull(walletRun.charged),
          inArray(jobs.status, ["completed", "partial", "failed", "cancelled"]),
        ),
      )
      .limit(20)
      .then((rows) => rows.map((row) => row.job)),
  withinHostedWorkspaceQuota: async (job: ClaimJob) => {
    const [result] = await db
      .select({ count: count() })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, job.workspaceId),
          sql`${jobs.creditsPerAnswer} > 0`,
          inArray(jobs.status, [
            "running",
            "completed",
            "partial",
            "failed",
            "cancelled",
          ]),
          gte(jobs.createdAt, new Date(Date.now() - 86_400_000).toISOString()),
        ),
      );
    return (result?.count ?? 0) <= 12;
  },
  failFunding: (job: ClaimJob, billingError: string) =>
    runBatch((tx) => [
      tx
        .update(items)
        .set({ status: "cancelled" })
        .where(and(eq(items.jobId, job.id), eq(items.status, "pending"))),
      tx
        .update(jobs)
        .set({ status: "failed", billingError })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"))),
    ]),

  runs: (projectId: string) =>
    db
      .select({
        id: aiRuns.id,
        createdAt: aiRuns.createdAt,
        locationCode: aiRuns.locationCode,
        languageCode: aiRuns.languageCode,
      })
      .from(aiRuns)
      .where(
        and(
          eq(aiRuns.projectId, projectId),
          inArray(aiRuns.status, ["completed", "partial"]),
        ),
      )
      .orderBy(desc(aiRuns.createdAt))
      .limit(25),
  answers: (projectId: string, runId: string) =>
    db
      .select({
        id: aiObservations.id,
        answer: aiObservations.answerMarkdown,
      })
      .from(aiObservations)
      .innerJoin(aiRuns, eq(aiObservations.runId, aiRuns.id))
      .where(
        and(
          eq(aiRuns.projectId, projectId),
          eq(aiRuns.id, runId),
          eq(aiObservations.status, "completed"),
          inArray(aiRuns.status, ["completed", "partial"]),
        ),
      )
      .orderBy(asc(aiObservations.id)),
  jobs: (projectId: string, actorId: string) =>
    db
      .select()
      .from(jobs)
      .where(and(eq(jobs.projectId, projectId), eq(jobs.actorId, actorId)))
      .orderBy(desc(jobs.createdAt))
      .limit(10),
  get: async (projectId: string, id: string) =>
    (
      await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.projectId, projectId), eq(jobs.id, id)))
        .limit(1)
    )[0],
  items: (jobId: string) =>
    db
      .select()
      .from(items)
      .where(eq(items.jobId, jobId))
      .orderBy(asc(items.id)),
  dailyJobs: async (projectId: string, cutoff: string) =>
    (
      await db
        .select({ count: count() })
        .from(jobs)
        .where(and(eq(jobs.projectId, projectId), gte(jobs.createdAt, cutoff)))
    )[0]?.count ?? 0,
  estimate: (
    job: typeof jobs.$inferInsert,
    entries: (typeof items.$inferInsert)[],
  ) =>
    runBatch((tx) => [
      tx.insert(jobs).values(job),
      ...entries.map((entry) => tx.insert(items).values(entry)),
    ]),
  queue: (job: ClaimJob, now: string) =>
    db
      .update(jobs)
      .set({ status: "queued" })
      .where(
        and(
          eq(jobs.id, job.id),
          eq(jobs.projectId, job.projectId),
          eq(jobs.status, "ready"),
          gte(jobs.expiresAt, now),
          sql`(select count(*) from ai_claim_jobs as recent where recent.project_id = ${job.projectId} and recent.status <> 'ready' and recent.created_at >= ${new Date(Date.parse(now) - 86_400_000).toISOString()}) < 12`,
        ),
      )
      .returning(),
  cancel: (job: ClaimJob) =>
    runBatch((tx) => [
      tx
        .update(jobs)
        .set({ status: "cancelled" })
        .where(
          and(eq(jobs.id, job.id), inArray(jobs.status, ["ready", "queued"])),
        ),
      tx
        .update(items)
        .set({ status: "cancelled" })
        .where(and(eq(items.jobId, job.id), eq(items.status, "pending"))),
    ]),
  queued: () =>
    db
      .select()
      .from(jobs)
      .where(eq(jobs.status, "queued"))
      .orderBy(asc(jobs.createdAt))
      .limit(4),
  claim: (jobId: string, leaseUntil: string) =>
    db
      .update(jobs)
      .set({ status: "running", leaseUntil })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "queued")))
      .returning(),
  active: async (jobId: string, lease: string, now: string) =>
    (
      await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.status, "running"),
            eq(jobs.leaseUntil, lease),
            gte(jobs.leaseUntil, now),
          ),
        )
        .limit(1)
    ).length > 0,
  access: async (job: ClaimJob) =>
    (
      await db
        .select({
          role: member.role,
          name: projects.name,
          brand: projects.brandName,
        })
        .from(projects)
        .innerJoin(
          member,
          and(
            eq(member.organizationId, projects.organizationId),
            eq(member.userId, job.actorId),
          ),
        )
        .where(
          and(
            eq(projects.id, job.projectId),
            eq(projects.organizationId, job.workspaceId),
            isNull(projects.archivedAt),
          ),
        )
        .limit(1)
    )[0],
  cached: async (job: ClaimJob, observationId: string, inputHash: string) =>
    (
      await db
        .select({ status: items.status })
        .from(items)
        .innerJoin(jobs, eq(items.jobId, jobs.id))
        .where(
          and(
            eq(items.observationId, observationId),
            eq(items.inputHash, inputHash),
            eq(jobs.projectId, job.projectId),
            eq(jobs.model, job.model),
            eq(jobs.provider, job.provider),
            eq(jobs.recipe, job.recipe),
            inArray(items.status, [
              "completed",
              "review",
              "dispatching",
              "unknown",
            ]),
          ),
        )
        .limit(1)
    )[0]?.status,
  dispatch: (job: ClaimJob, item: ClaimItem, now: string) =>
    db
      .update(items)
      .set({ status: "dispatching" })
      .where(
        and(
          eq(items.id, item.id),
          eq(items.status, "pending"),
          sql`exists (select 1 from ${jobs} where ${jobs.id} = ${item.jobId} and ${jobs.status} = 'running' and ${jobs.leaseUntil} = ${job.leaseUntil} and ${jobs.leaseUntil} >= ${now})`,
        ),
      )
      .returning(),
  finishItem: (
    item: ClaimItem,
    patch: Partial<typeof items.$inferInsert>,
    rows: {
      claim: typeof claims.$inferInsert;
      occurrence: typeof occurrences.$inferInsert;
    }[] = [],
  ) =>
    runBatch((tx) => [
      ...rows.flatMap(({ claim, occurrence }) => [
        tx.insert(claims).values(claim).onConflictDoNothing(),
        tx.insert(occurrences).values(occurrence).onConflictDoNothing(),
      ]),
      tx
        .update(items)
        .set(patch)
        .where(
          and(
            eq(items.id, item.id),
            inArray(items.status, ["pending", "dispatching", "unknown"]),
          ),
        ),
    ]),
  finishJob: (
    job: ClaimJob,
    status: "completed" | "partial" | "failed" | "cancelled",
  ) =>
    db
      .update(jobs)
      .set({ status })
      .where(
        and(
          eq(jobs.id, job.id),
          eq(jobs.status, "running"),
          eq(jobs.leaseUntil, job.leaseUntil!),
        ),
      )
      .returning({ id: jobs.id }),
  recover: async (now: string) => {
    const expired = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, "running"), lt(jobs.leaseUntil, now)))
      .limit(10);
    for (const job of expired)
      await runBatch((tx) => [
        tx
          .update(jobs)
          .set({ status: "partial" })
          .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"))),
        tx
          .update(items)
          .set({ status: "unknown", errorCode: "dispatch_interrupted" })
          .where(and(eq(items.jobId, job.id), eq(items.status, "dispatching"))),
        tx
          .update(items)
          .set({ status: "cancelled" })
          .where(and(eq(items.jobId, job.id), eq(items.status, "pending"))),
      ]);
    await db
      .delete(jobs)
      .where(and(eq(jobs.status, "ready"), lt(jobs.expiresAt, now)));
    await db
      .update(jobs)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(jobs.status, "queued"),
          lt(
            jobs.createdAt,
            new Date(Date.parse(now) - 86_400_000).toISOString(),
          ),
        ),
      );
  },
};
