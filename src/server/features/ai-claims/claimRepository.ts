import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  lt,
  lte,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  aiBrandFacts,
  aiClaimAssessmentFacts as assessmentFacts,
  aiClaimAssessments as assessments,
  aiClaimExtractions as items,
  aiClaimFactVersions as facts,
  aiClaimJobs as jobs,
  aiClaimOccurrences as occurrences,
  aiClaims as claims,
  aiClaimSourceSnapshots as snapshots,
  aiClaimSourceReviews as sourceReviews,
  aiObservations,
  aiObservationRetrievals,
  aiPrompts,
  aiRuns,
  aiSources,
} from "@/db/schema";

export type SavedFact = typeof facts.$inferSelect;
type ClaimFilters = {
  engine?: string;
  market?: number;
  category?: string;
  since?: string;
  until?: string;
};
const occurrenceQuery = () =>
  db
    .select({
      occurrence: {
        ...getTableColumns(occurrences),
        id: sql<string>`${occurrences.id}`.as("occurrence_id"),
      },
      claim: claims,
      inputHash: items.inputHash,
      extractor:
        sql<string>`COALESCE(${items.resolvedModel}, ${jobs.model})`.as(
          "extractor_model",
        ),
      extractionVersion: jobs.recipe,
      answerId: sql<string>`${aiObservations.id}`.as("answer_id"),
      answer: aiObservations.answerMarkdown,
      engine: aiObservations.engine,
      model: aiObservations.model,
      observedAt: aiObservations.collectedAt,
      locationCode: aiRuns.locationCode,
      languageCode: aiRuns.languageCode,
      runId: sql<string>`${aiRuns.id}`.as("run_id"),
      promptId: sql<string>`${aiPrompts.id}`.as("prompt_id"),
      prompt: aiPrompts.text,
    })
    .from(occurrences)
    .innerJoin(claims, eq(occurrences.claimId, claims.id))
    .innerJoin(items, eq(occurrences.extractionId, items.id))
    .innerJoin(jobs, eq(items.jobId, jobs.id))
    .innerJoin(aiObservations, eq(items.observationId, aiObservations.id))
    .innerJoin(aiRuns, eq(aiObservations.runId, aiRuns.id))
    .innerJoin(aiPrompts, eq(aiObservations.promptId, aiPrompts.id));

export const claimRepository = {
  listOccurrences: (projectId: string, filters: ClaimFilters) =>
    occurrenceQuery()
      .where(
        and(
          eq(claims.projectId, projectId),
          eq(jobs.projectId, projectId),
          eq(aiRuns.projectId, projectId),
          filters.engine
            ? sql`${aiObservations.engine} = ${filters.engine}`
            : undefined,
          filters.market ? eq(aiRuns.locationCode, filters.market) : undefined,
          filters.category ? eq(claims.category, filters.category) : undefined,
          filters.since
            ? gte(aiObservations.collectedAt, filters.since)
            : undefined,
          filters.until
            ? lte(aiObservations.collectedAt, `${filters.until}T23:59:59.999Z`)
            : undefined,
        ),
      )
      .orderBy(desc(aiObservations.collectedAt), desc(occurrences.id))
      .limit(1001),
  findOccurrence: async (projectId: string, id: string) =>
    (
      await occurrenceQuery()
        .where(
          and(
            eq(claims.projectId, projectId),
            eq(jobs.projectId, projectId),
            eq(aiRuns.projectId, projectId),
            eq(occurrences.id, id),
          ),
        )
        .limit(1)
    )[0],
  claim: async (projectId: string, id: string) =>
    (
      await db
        .select()
        .from(claims)
        .where(and(eq(claims.projectId, projectId), eq(claims.id, id)))
        .limit(1)
    )[0],
  sourceRows: async (answerId: string) => ({
    citations: await db
      .select()
      .from(aiSources)
      .where(eq(aiSources.observationId, answerId))
      .limit(60),
    retrievals: await db
      .select()
      .from(aiObservationRetrievals)
      .where(eq(aiObservationRetrievals.observationId, answerId))
      .limit(60),
  }),
  facts: (projectId: string) =>
    db
      .select()
      .from(facts)
      .where(eq(facts.projectId, projectId))
      .orderBy(desc(facts.createdAt))
      .limit(251),
  applicableFacts: (projectId: string, date: string) =>
    db
      .select()
      .from(facts)
      .where(
        and(
          eq(facts.projectId, projectId),
          inArray(facts.state, ["approved", "superseded", "retired"]),
          lte(facts.effectiveFrom, date),
        ),
      )
      .orderBy(desc(facts.effectiveFrom), desc(facts.reviewedAt))
      .limit(251),
  fact: async (projectId: string, id: string) =>
    (
      await db
        .select()
        .from(facts)
        .where(and(eq(facts.projectId, projectId), eq(facts.id, id)))
        .limit(1)
    )[0],
  legacyFacts: (projectId: string) =>
    db.select().from(aiBrandFacts).where(eq(aiBrandFacts.projectId, projectId)),
  saveFact: (row: typeof facts.$inferInsert) => db.insert(facts).values(row),
  review: (
    fact: SavedFact,
    actorId: string,
    now: string,
    action: "approve" | "retire",
  ) => {
    const stillDraft = sql`exists (select 1 from ai_claim_fact_versions as pending where pending.id = ${fact.id} and pending.project_id = ${fact.projectId} and pending.state = 'draft')`;
    const existingApproval = sql`exists (select 1 from ai_claim_fact_versions as current where current.project_id = ${fact.projectId} and current.fact_key = ${fact.factKey} and current.state = 'approved')`;
    const scope = and(
      eq(facts.projectId, fact.projectId),
      eq(facts.factKey, fact.factKey),
    );
    return runBatch((tx) => [
      ...(action === "approve"
        ? [
            tx
              .update(facts)
              .set({ state: "superseded" })
              .where(and(scope, eq(facts.state, "approved"), stillDraft)),
          ]
        : []),
      tx
        .update(facts)
        .set({
          state:
            action === "approve"
              ? "approved"
              : fact.state === "draft"
                ? "discarded"
                : "retired",
          reviewerId: actorId,
          reviewedAt: now,
        })
        .where(
          and(
            scope,
            eq(facts.id, fact.id),
            eq(facts.state, fact.state),
            action === "approve" ? sql`not ${existingApproval}` : undefined,
          ),
        ),
    ]);
  },
  recentAssessments: (projectId: string) =>
    db
      .select({
        occurrenceId: assessments.occurrenceId,
        status: assessments.status,
        review: assessments.review,
      })
      .from(assessments)
      .where(eq(assessments.projectId, projectId))
      .orderBy(desc(assessments.createdAt), desc(assessments.id))
      .limit(1000),
  assessments: (projectId: string, occurrenceId: string) =>
    db
      .select()
      .from(assessments)
      .where(
        and(
          eq(assessments.projectId, projectId),
          eq(assessments.occurrenceId, occurrenceId),
        ),
      )
      .orderBy(desc(assessments.createdAt))
      .limit(20),
  assessmentEvidence: (projectId: string, assessmentId: string) =>
    db
      .select({ fact: facts })
      .from(assessmentFacts)
      .innerJoin(facts, eq(assessmentFacts.factVersionId, facts.id))
      .where(
        and(
          eq(facts.projectId, projectId),
          eq(assessmentFacts.assessmentId, assessmentId),
        ),
      ),
  saveAssessment: (row: typeof assessments.$inferInsert, factIds: string[]) =>
    runBatch((tx) => [
      tx.insert(assessments).values(row).onConflictDoNothing(),
      ...factIds.map((factVersionId) =>
        tx
          .insert(assessmentFacts)
          .values({
            id: crypto.randomUUID(),
            assessmentId: row.id,
            factVersionId,
          })
          .onConflictDoNothing(),
      ),
    ]),
  reviewAssessment: (
    projectId: string,
    id: string,
    actorId: string,
    review: "confirmed" | "dismissed",
    now: string,
  ) =>
    db
      .update(assessments)
      .set({ reviewerId: actorId, reviewedAt: now, review })
      .where(
        and(
          eq(assessments.projectId, projectId),
          eq(assessments.id, id),
          isNull(assessments.review),
          review === "confirmed"
            ? eq(assessments.status, "conflict")
            : undefined,
        ),
      )
      .returning(),
  snapshots: (projectId: string, urls: string[], since: string) =>
    urls.length
      ? db
          .select()
          .from(snapshots)
          .where(
            and(
              eq(snapshots.projectId, projectId),
              inArray(snapshots.url, urls),
              gte(snapshots.fetchedAt, since),
            ),
          )
          .orderBy(desc(snapshots.fetchedAt))
          .limit(100)
      : Promise.resolve([]),
  sourceReviews: (projectId: string, occurrenceId: string) =>
    db
      .select()
      .from(sourceReviews)
      .where(
        and(
          eq(sourceReviews.projectId, projectId),
          eq(sourceReviews.occurrenceId, occurrenceId),
        ),
      )
      .orderBy(desc(sourceReviews.createdAt))
      .limit(100),
  saveSourceReview: (row: typeof sourceReviews.$inferInsert) =>
    db.insert(sourceReviews).values(row),
  pruneSnapshots: async (cutoff: string) => {
    const ids = db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(lt(snapshots.fetchedAt, cutoff))
      .limit(200);
    await db.delete(snapshots).where(inArray(snapshots.id, ids));
  },
  dailySnapshots: async (projectId: string, since: string) =>
    (
      await db
        .select({ count: count() })
        .from(snapshots)
        .where(
          and(
            eq(snapshots.projectId, projectId),
            gte(snapshots.fetchedAt, since),
          ),
        )
    )[0]?.count ?? 0,
  reserveSnapshot: (row: typeof snapshots.$inferInsert) =>
    db.insert(snapshots).values(row).onConflictDoNothing().returning(),
  finishSnapshot: (
    projectId: string,
    id: string,
    patch: Partial<typeof snapshots.$inferInsert>,
  ) =>
    db
      .update(snapshots)
      .set(patch)
      .where(and(eq(snapshots.projectId, projectId), eq(snapshots.id, id))),
};
