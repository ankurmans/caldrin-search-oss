import {
  changeLedgerEntries,
  contentAssets,
  contentOpportunities,
} from "./content.schema";
import { sql } from "drizzle-orm";
import {
  integer,
  real,
  text,
  sqliteTable,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { aiRuns, aiObservations } from "./ai-visibility.schema";
import { aiBrandFacts } from "./ai-fact-check.schema";

export const aiClaimJobs = sqliteTable(
  "ai_claim_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    creditsPerAnswer: integer("credits_per_answer").notNull().default(0),
    billingError: text("billing_error"),
    recipe: text("recipe").notNull(),
    status: text("status", {
      enum: [
        "ready",
        "queued",
        "running",
        "completed",
        "partial",
        "failed",
        "cancelled",
      ],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    leaseUntil: text("lease_until"),
  },
  (t) => [
    index("ai_claim_jobs_queue_idx").on(t.status, t.createdAt),
    uniqueIndex("ai_claim_jobs_active_project")
      .on(t.projectId)
      .where(sql`${t.status} IN ('queued', 'running')`),
    uniqueIndex("ai_claim_jobs_running_workspace")
      .on(t.workspaceId)
      .where(sql`${t.status} = 'running'`),
  ],
);

export const aiClaimExtractions = sqliteTable(
  "ai_claim_extractions",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => aiClaimJobs.id, { onDelete: "cascade" }),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiObservations.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    status: text("status", {
      enum: [
        "pending",
        "dispatching",
        "completed",
        "review",
        "failed",
        "unknown",
        "cached",
        "cancelled",
      ],
    }).notNull(),
    errorCode: text("error_code"),
    resolvedModel: text("resolved_model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: real("cost_usd"),
  },
  (t) => [
    uniqueIndex("ai_claim_extractions_job_observation").on(
      t.jobId,
      t.observationId,
    ),
  ],
);

export const aiClaims = sqliteTable(
  "ai_claims",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("claim_key").notNull(),
    subject: text("subject").notNull(),
    predicate: text("predicate").notNull(),
    value: text("claim_value").notNull(),
    category: text("category").notNull(),
    polarity: text("polarity", { enum: ["asserts", "denies"] }).notNull(),
    plan: text("plan"),
    market: text("market"),
    product: text("product"),
    version: text("product_version"),
    effectiveDate: text("effective_date"),
    condition: text("condition"),
    mergedInto: text("merged_into"),
  },
  (t) => [uniqueIndex("ai_claims_project_key").on(t.projectId, t.key)],
);

export const aiClaimOccurrences = sqliteTable(
  "ai_claim_occurrences",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => aiClaims.id, { onDelete: "cascade" }),
    extractionId: text("extraction_id")
      .notNull()
      .references(() => aiClaimExtractions.id, { onDelete: "cascade" }),
    start: integer("span_start").notNull(),
    end: integer("span_end").notNull(),
    confidence: real("confidence").notNull(),
  },
  (t) => [
    uniqueIndex("ai_claim_occurrence_span").on(
      t.extractionId,
      t.claimId,
      t.start,
      t.end,
    ),
    index("ai_claim_occurrences_claim").on(t.claimId),
  ],
);

export const aiClaimFactVersions = sqliteTable(
  "ai_claim_fact_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    factKey: text("fact_key").notNull(),
    previousId: text("previous_id"),
    legacyFactId: text("legacy_fact_id").references(() => aiBrandFacts.id, {
      onDelete: "set null",
    }),
    subject: text("subject").notNull(),
    predicate: text("predicate").notNull(),
    value: text("fact_value").notNull(),
    polarity: text("polarity", { enum: ["asserts", "denies"] }).notNull(),
    plan: text("plan"),
    product: text("product"),
    market: text("market"),
    version: text("product_version"),
    condition: text("condition"),
    effectiveFrom: text("effective_from").notNull(),
    effectiveUntil: text("effective_until"),
    sourceUrl: text("source_url"),
    evidence: text("evidence").notNull(),
    ownerId: text("owner_id").notNull(),
    reviewerId: text("reviewer_id"),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull(),
    state: text("state", {
      enum: ["draft", "approved", "superseded", "retired", "discarded"],
    }).notNull(),
  },
  (t) => [
    index("ai_claim_fact_versions_project").on(t.projectId, t.createdAt),
    uniqueIndex("ai_claim_fact_active_approval")
      .on(t.projectId, t.factKey)
      .where(sql`${t.state} = 'approved'`),
    uniqueIndex("ai_claim_fact_active_draft")
      .on(t.projectId, t.factKey)
      .where(sql`${t.state} = 'draft'`),
  ],
);

export const aiClaimAssessments = sqliteTable(
  "ai_claim_assessments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    occurrenceId: text("occurrence_id")
      .notNull()
      .references(() => aiClaimOccurrences.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["consistent", "conflict", "mixed", "insufficient"],
    }).notNull(),
    recipe: text("recipe").notNull(),
    inputHash: text("input_hash").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: text("created_at").notNull(),
    reviewerId: text("reviewer_id"),
    reviewedAt: text("reviewed_at"),
    review: text("review", { enum: ["confirmed", "dismissed"] }),
  },
  (t) => [
    uniqueIndex("ai_claim_assessments_input").on(
      t.occurrenceId,
      t.recipe,
      t.inputHash,
    ),
  ],
);

export const aiClaimAssessmentFacts = sqliteTable(
  "ai_claim_assessment_facts",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => aiClaimAssessments.id, { onDelete: "cascade" }),
    factVersionId: text("fact_version_id")
      .notNull()
      .references(() => aiClaimFactVersions.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("ai_claim_assessment_fact").on(t.assessmentId, t.factVersionId),
  ],
);

export const aiClaimSourceSnapshots = sqliteTable(
  "ai_claim_source_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    canonicalUrl: text("canonical_url"),
    title: text("title"),
    excerpt: text("excerpt"),
    matchingPassage: text("matching_passage"),
    contentHash: text("content_hash"),
    httpStatus: integer("http_status"),
    reason: text("reason"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [
    index("ai_claim_snapshots_cache").on(t.projectId, t.url, t.fetchedAt),
  ],
);

export const aiClaimSourceReviews = sqliteTable(
  "ai_claim_source_reviews",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    occurrenceId: text("occurrence_id")
      .notNull()
      .references(() => aiClaimOccurrences.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => aiClaimSourceSnapshots.id, { onDelete: "cascade" }),
    relation: text("relation", {
      enum: [
        "corroborating",
        "conflicting",
        "potentially_stale",
        "insufficient",
      ],
    }).notNull(),
    relevance: text("relevance", {
      enum: ["direct", "context_only"],
    }).notNull(),
    rationale: text("rationale").notNull(),
    reviewerId: text("reviewer_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("ai_claim_source_reviews_occurrence").on(
      t.projectId,
      t.occurrenceId,
      t.createdAt,
    ),
  ],
);

export const aiClaimCorrections = sqliteTable(
  "ai_claim_corrections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assessmentId: text("assessment_id").references(
      () => aiClaimAssessments.id,
      { onDelete: "set null" },
    ),
    claimId: text("claim_id").references(() => aiClaims.id, {
      onDelete: "set null",
    }),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => contentOpportunities.id, { onDelete: "cascade" }),
    assetId: text("asset_id").references(() => contentAssets.id, {
      onDelete: "set null",
    }),
    outreachDraft: text("outreach_draft"),
    ledgerId: text("ledger_id").references(() => changeLedgerEntries.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: ["owned", "external"] }).notNull(),
    targetUrl: text("target_url").notNull(),
    baselineRunId: text("baseline_run_id").references(() => aiRuns.id, {
      onDelete: "set null",
    }),
    baselineObservationId: text("baseline_observation_id").references(
      () => aiObservations.id,
      { onDelete: "set null" },
    ),
    factVersionId: text("fact_version_id")
      .notNull()
      .references(() => aiClaimFactVersions.id, { onDelete: "no action" }),
    beforeSnapshotId: text("before_snapshot_id").references(
      () => aiClaimSourceSnapshots.id,
      { onDelete: "set null" },
    ),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ai_claim_corrections_project").on(t.projectId, t.createdAt)],
);

export const aiClaimGroupHistory = sqliteTable(
  "ai_claim_group_history",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    claimId: text("claim_id")
      .notNull()
      .references(() => aiClaims.id, { onDelete: "cascade" }),
    previousTarget: text("previous_target"),
    target: text("target"),
    actorId: text("actor_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ai_claim_group_history_claim").on(t.claimId, t.createdAt)],
);

export const aiClaimFollowups = sqliteTable(
  "ai_claim_followups",
  {
    id: text("id").primaryKey(),
    correctionId: text("correction_id")
      .notNull()
      .references(() => aiClaimCorrections.id, { onDelete: "cascade" }),
    ledgerId: text("ledger_id")
      .notNull()
      .references(() => changeLedgerEntries.id, { onDelete: "cascade" }),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiObservations.id, { onDelete: "cascade" }),
    outcome: text("outcome", {
      enum: [
        "matches_fact",
        "conflict_persists",
        "not_found_in_extraction",
        "inconclusive",
      ],
    }).notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("ai_claim_followups_observation").on(
      t.correctionId,
      t.observationId,
    ),
  ],
);
