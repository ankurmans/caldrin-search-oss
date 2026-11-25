import { LedgerRepository } from "@/server/features/ledger/repositories/LedgerRepository";
import { runQualityChecks } from "@/server/features/content/rules/qualityChecks";
import { escapeHtml } from "@/server/features/content/rules/sanitizeHtml";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  aiClaimCorrections as corrections,
  aiClaimAssessments as assessments,
  aiClaimExtractions as extractions,
  aiClaimFollowups as followups,
  aiClaimJobs as jobs,
  aiClaimOccurrences as occurrences,
  aiClaims as claims,
  aiObservations,
  aiRuns,
  contentOpportunities,
  opportunityEvidence,
  contentAssets,
  contentAssetVersions,
  contentQualityChecks,
  changeLedgerEntries,
  changeLedgerEvidence,
  changeLedgerObservations,
  aiClaimSourceSnapshots,
} from "@/db/schema";
import type { EvidenceInput } from "@/server/features/ledger/types";

type Correction = typeof corrections.$inferSelect;
type Baseline = {
  observation: typeof aiObservations.$inferSelect;
  market: number;
  language: string;
};

export const claimCorrectionRepository = {
  assessment: async (projectId: string, id: string) =>
    (
      await db
        .select()
        .from(assessments)
        .where(
          and(eq(assessments.projectId, projectId), eq(assessments.id, id)),
        )
        .limit(1)
    )[0],
  get: async (projectId: string, id: string) =>
    (
      await db
        .select()
        .from(corrections)
        .where(
          and(eq(corrections.projectId, projectId), eq(corrections.id, id)),
        )
        .limit(1)
    )[0],
  list: (projectId: string, assessmentId: string) =>
    db
      .select()
      .from(corrections)
      .where(
        and(
          eq(corrections.projectId, projectId),
          eq(corrections.assessmentId, assessmentId),
        ),
      )
      .orderBy(desc(corrections.createdAt))
      .limit(20),
  insert: ({
    correction,
    actorId,
    organizationId,
    title,
    brief,
    replacement,
    evidence,
  }: {
    correction: typeof corrections.$inferInsert;
    actorId: string;
    organizationId: string;
    title: string;
    brief: string;
    replacement: string;
    evidence: EvidenceInput[];
  }) => {
    const draft = {
      title,
      bodyHtml: `<p>${escapeHtml(replacement)}</p>`,
      metaTitle: title.slice(0, 120),
      metaDescription: "",
    };
    const quality = correction.assetId
      ? runQualityChecks(
          draft,
          {
            shopName: "",
            products: [],
            collections: [],
            articles: [],
          },
          false,
        )
      : [];
    return runBatch((tx) => [
      tx
        .insert(contentOpportunities)
        .values({
          id: correction.opportunityId,
          projectId: correction.projectId,
          organizationId,
          dedupeKey: `claim-correction:${correction.id}`,
          query: title,
          pageUrl: correction.targetUrl,
          impressions: 0,
          clicks: 0,
          ctr: 0,
          position: 0,
          windowStart: correction.createdAt.slice(0, 10),
          windowEnd: correction.createdAt.slice(0, 10),
          reason: brief,
          dataSource: "claim_correction",
          recommendedAction:
            correction.kind === "owned"
              ? "refresh_existing_page"
              : "earn_third_party_coverage",
          priority: "high",
          priorityReason:
            "A reviewer confirmed the conflict against an approved fact.",
          observedAt: correction.createdAt,
          status: "briefed",
        })
        .onConflictDoNothing(),
      ...evidence.map((item, index) =>
        tx
          .insert(opportunityEvidence)
          .values({
            ...item,
            id: `${correction.id}:e${index}`,
            opportunityId: correction.opportunityId,
          })
          .onConflictDoNothing(),
      ),
      ...(correction.assetId
        ? [
            tx
              .insert(contentAssets)
              .values({
                id: correction.assetId,
                opportunityId: correction.opportunityId,
                projectId: correction.projectId,
                organizationId,
                ...draft,
                searchIntent:
                  "Review and update the specific factual statement",
                briefMarkdown: brief,
                importWarning:
                  "This draft is a replacement passage. Apply it in context on the target page.",
                generator: "template",
                createdByUserId: actorId,
              })
              .onConflictDoNothing(),
            tx
              .insert(contentAssetVersions)
              .values({
                id: `${correction.assetId}:1`,
                assetId: correction.assetId,
                revision: 1,
                ...draft,
                editedByUserId: actorId,
              })
              .onConflictDoNothing(),
            ...quality.map((check) =>
              tx
                .insert(contentQualityChecks)
                .values({
                  id: `${correction.assetId}:1:${check.key}`,
                  assetId: correction.assetId!,
                  revision: 1,
                  checkKey: check.key,
                  passed: check.passed,
                  detail: check.detail,
                  severity: check.severity,
                })
                .onConflictDoNothing(),
            ),
          ]
        : []),
      tx.insert(corrections).values(correction).onConflictDoNothing(),
    ]);
  },
  attachLedger: (correction: Correction, ledgerId: string) =>
    db
      .update(corrections)
      .set({ ledgerId })
      .where(
        and(
          eq(corrections.projectId, correction.projectId),
          eq(corrections.id, correction.id),
        ),
      ),
  relatedLedger: (correction: Correction) =>
    db
      .select()
      .from(changeLedgerEntries)
      .where(
        and(
          eq(changeLedgerEntries.projectId, correction.projectId),
          eq(changeLedgerEntries.opportunityId, correction.opportunityId),
        ),
      )
      .orderBy(desc(changeLedgerEntries.createdAt))
      .limit(25),
  baseline: async (correction: Correction) => {
    if (!correction.baselineObservationId) return undefined;
    return (
      await db
        .select({
          observation: aiObservations,
          market: aiRuns.locationCode,
          language: aiRuns.languageCode,
        })
        .from(aiObservations)
        .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
        .where(
          and(
            eq(aiRuns.projectId, correction.projectId),
            eq(aiObservations.id, correction.baselineObservationId),
          ),
        )
        .limit(1)
    )[0];
  },
  candidates: (projectId: string, baseline: Baseline, publishedAt: string) =>
    db
      .select({
        id: aiObservations.id,
        runId: aiObservations.runId,
        model: aiObservations.model,
        collectedAt: aiObservations.collectedAt,
        sameAnswer:
          sql<boolean>`${aiObservations.answerMarkdown} = ${baseline.observation.answerMarkdown}`.mapWith(
            Boolean,
          ),
      })
      .from(aiObservations)
      .innerJoin(aiRuns, eq(aiRuns.id, aiObservations.runId))
      .where(
        and(
          eq(aiRuns.projectId, projectId),
          eq(aiRuns.locationCode, baseline.market),
          eq(aiRuns.languageCode, baseline.language),
          eq(aiObservations.promptId, baseline.observation.promptId),
          eq(aiObservations.engine, baseline.observation.engine),
          eq(aiObservations.status, "completed"),
          gt(aiObservations.collectedAt, publishedAt),
          baseline.observation.model
            ? eq(aiObservations.model, baseline.observation.model)
            : sql`${aiObservations.model} is null`,
        ),
      )
      .orderBy(desc(aiObservations.collectedAt), asc(aiObservations.id))
      .limit(20),
  readings: async (projectId: string, observationId: string) => {
    const [entry] = await db
      .select({ id: extractions.id, status: extractions.status })
      .from(extractions)
      .innerJoin(jobs, eq(jobs.id, extractions.jobId))
      .where(
        and(
          eq(jobs.projectId, projectId),
          eq(extractions.observationId, observationId),
          inArray(extractions.status, ["completed", "review"]),
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    if (!entry) return null;
    const scoped = await db
      .select({ claim: claims })
      .from(occurrences)
      .innerJoin(claims, eq(claims.id, occurrences.claimId))
      .where(
        and(
          eq(occurrences.extractionId, entry.id),
          eq(claims.projectId, projectId),
        ),
      );
    return {
      complete: entry.status === "completed",
      claims: scoped.map((row) => row.claim),
    };
  },
  publishVerified: async (
    row: Correction,
    ledgerId: string,
    snapshot: typeof aiClaimSourceSnapshots.$inferInsert,
    actorId: string,
  ) => {
    const ledger = changeLedgerEntries;
    const allowed = and(
      eq(ledger.id, ledgerId),
      eq(ledger.projectId, row.projectId),
      eq(ledger.status, "approved"),
      eq(ledger.provider, "manual"),
      eq(ledger.targetUrl, row.targetUrl),
      sql`${ledger.approvedByUserId} is not null`,
      sql`exists (select 1 from ai_claim_corrections where id = ${row.id} and ledger_id = ${ledgerId})`,
      sql`(${ledger.contentAssetId} is null or exists (
        select 1 from content_assets as draft where draft.id = ${ledger.contentAssetId} and draft.project_id = ${row.projectId}
        and draft.status = 'approved' and draft.revision = ${ledger.approvedRevision} and draft.approved_revision = draft.revision
      ))`,
    );
    const proofId = `claim-after:${ledgerId}`;
    await runBatch((tx) => [
      tx
        .update(ledger)
        .set({ status: sql`${ledger.status}` })
        .where(eq(ledger.id, ledgerId)),
      tx.insert(aiClaimSourceSnapshots).values(snapshot).onConflictDoNothing(),
      tx
        .insert(changeLedgerEvidence)
        .select(
          tx
            .select({
              id: sql<string>`${proofId}`.as("id"),
              entryId: ledger.id,
              source: sql<string>`'claim_source'`.as("source"),
              label: sql<string>`'Verified public passage'`.as("label"),
              value:
                sql<string>`${JSON.stringify({ snapshotId: snapshot.id, digest: snapshot.contentHash, passage: snapshot.matchingPassage })}`.as(
                  "value",
                ),
              url: ledger.targetUrl,
              observedAt: sql<string>`${snapshot.fetchedAt}`.as("observed_at"),
            })
            .from(ledger)
            .where(allowed),
        )
        .onConflictDoNothing(),
      tx
        .update(ledger)
        .set({
          status: "executed",
          publicationStatus: "published",
          executedByUserId: actorId,
          executedAt: snapshot.fetchedAt,
          updatedAt: snapshot.fetchedAt,
          afterState: snapshot.excerpt,
        })
        .where(
          and(
            allowed,
            sql`exists (select 1 from ${changeLedgerEvidence} where ${changeLedgerEvidence.id} = ${proofId})`,
          ),
        ),
    ]);
    const entry = await LedgerRepository.getEntry(row.projectId, ledgerId);
    return entry?.publicationStatus === "published";
  },
  history: (correctionId: string) =>
    db
      .select()
      .from(followups)
      .where(eq(followups.correctionId, correctionId))
      .orderBy(desc(followups.createdAt))
      .limit(20),
  record: (entry: typeof followups.$inferInsert, runId: string) =>
    runBatch((tx) => [
      tx.insert(followups).values(entry).onConflictDoNothing(),
      tx
        .insert(changeLedgerObservations)
        .select(
          tx
            .select({
              id: sql<string>`cast(${entry.id} as text)`.as("id"),
              entryId: followups.ledgerId,
              phase: sql<"follow_up">`'follow_up'`.as("phase"),
              source: sql<"ai_visibility">`'ai_visibility'`.as("source"),
              metric: sql<string>`${"claim_correction_" + entry.outcome}`.as(
                "metric",
              ),
              value: sql<number>`1`.as("value"),
              numerator: sql<null>`NULL`.as("numerator"),
              denominator: sql<null>`NULL`.as("denominator"),
              windowStart: sql<null>`NULL`.as("window_start"),
              windowEnd: sql<null>`NULL`.as("window_end"),
              observedAt: followups.createdAt,
              aiRunId: sql<string>`${runId}`.as("ai_run_id"),
              note: sql<string>`'One comparable saved answer. The result does not establish causation.'`.as(
                "note",
              ),
            })
            .from(followups)
            .where(eq(followups.id, entry.id)),
        )
        .onConflictDoNothing(),
    ]),
};
