import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contentAssets,
  contentOpportunities,
  contentRefreshJobs as jobs,
} from "@/db/schema";

const timestamp = () => new Date().toISOString();

function insert(
  projectId: string,
  batchId: string,
  requestedBy: string,
  opportunityIds: string[],
) {
  return db
    .insert(jobs)
    .values(
      opportunityIds.map((opportunityId) => ({
        id: crypto.randomUUID(),
        projectId,
        opportunityId,
        batchId,
        requestedBy,
        status: "queued" as const,
        updatedAt: timestamp(),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: jobs.id });
}

async function retry(
  projectId: string,
  id: string,
  batchId: string,
  requestedBy: string,
) {
  const [job] = await db
    .update(jobs)
    .set({
      batchId,
      requestedBy,
      status: "queued",
      reason: null,
      updatedAt: timestamp(),
    })
    .where(
      and(
        eq(jobs.projectId, projectId),
        eq(jobs.id, id),
        eq(jobs.status, "failed"),
      ),
    )
    .returning({ id: jobs.id });
  return job ?? null;
}

function batchJobs(batchId: string) {
  return db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.batchId, batchId))
    .orderBy(asc(jobs.id));
}

async function claim(batchId: string, id: string) {
  const [job] = await db
    .update(jobs)
    .set({ status: "running", updatedAt: timestamp() })
    .where(
      and(
        eq(jobs.batchId, batchId),
        eq(jobs.id, id),
        eq(jobs.status, "queued"),
      ),
    )
    .returning();
  return job ?? null;
}

function finish(
  batchId: string,
  id: string,
  status: "ready" | "failed",
  reason: string | null,
) {
  return db
    .update(jobs)
    .set({ status, reason, updatedAt: timestamp() })
    .where(
      and(
        eq(jobs.batchId, batchId),
        eq(jobs.id, id),
        eq(jobs.status, "running"),
      ),
    );
}

function interruptedBatch(batchId: string, id?: string) {
  return db
    .update(jobs)
    .set({
      status: "failed",
      reason:
        "The background job stopped. Open the imported draft or retry this page.",
      updatedAt: timestamp(),
    })
    .where(
      and(
        eq(jobs.batchId, batchId),
        id ? eq(jobs.id, id) : undefined,
        inArray(jobs.status, ["queued", "running"]),
      ),
    );
}

function staleBatches(before: string) {
  return db
    .selectDistinct({ batchId: jobs.batchId })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ["queued", "running"]),
        lte(jobs.updatedAt, before),
      ),
    )
    .limit(30);
}

function list(projectId: string) {
  return db
    .select({
      id: jobs.id,
      opportunityId: jobs.opportunityId,
      label: contentOpportunities.query,
      status: jobs.status,
      reason: jobs.reason,
      assetId: contentAssets.id,
    })
    .from(jobs)
    .innerJoin(
      contentOpportunities,
      eq(jobs.opportunityId, contentOpportunities.id),
    )
    .leftJoin(
      contentAssets,
      and(
        eq(contentAssets.projectId, projectId),
        eq(contentAssets.opportunityId, jobs.opportunityId),
        eq(contentAssets.id, sql`'refresh-' || ${jobs.opportunityId}`),
      ),
    )
    .where(eq(jobs.projectId, projectId))
    .orderBy(
      sql`case when ${jobs.status} in ('queued', 'running') then 0 else 1 end`,
      desc(jobs.updatedAt),
      asc(jobs.id),
    )
    .limit(25);
}

export const ContentRefreshRepository = {
  insert,
  retry,
  batchJobs,
  claim,
  finish,
  interruptedBatch,
  staleBatches,
  list,
};
