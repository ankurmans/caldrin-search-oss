/* eslint-disable max-lines -- content, ledger and spend table declarations */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// See src/db/pg/app.schema.ts for why timestamps are ISO-8601 UTC text.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// Content studio: search opportunity -> brief -> draft -> approval -> publish.

// One connected Shopify store per project. `mode` is "simulated" for the local
// test shop (no token, never calls Shopify) and "live" for a real store whose
// Admin API token is stored sealed (see server/lib/secret-box.ts).
export const shopifyConnections = pgTable(
  "shopify_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // "example.myshopify.com", validated before storing.
    shopDomain: text("shop_domain").notNull(),
    mode: text("mode", { enum: ["live", "simulated"] }).notNull(),
    // A live connection to a Shopify development store (partner test store).
    isDevelopmentStore: boolean("is_development_store")
      .notNull()
      .default(false),
    sealedAccessToken: text("sealed_access_token"),
    // Public Shopify apps get expiring offline tokens: a 1 hour access token and
    // a 90 day refresh token, both sealed. Legacy admin-created tokens have
    // neither expiry.
    sealedRefreshToken: text("sealed_refresh_token"),
    accessTokenExpiresAt: text("access_token_expires_at"),
    refreshTokenExpiresAt: text("refresh_token_expires_at"),
    // Comma-separated scopes the token was granted, as reported by Shopify.
    grantedScopes: text("granted_scopes").notNull().default(""),
    // Publishing needs write_content; connections without it can only read.
    canPublish: boolean("can_publish").notNull().default(false),
    apiVersion: text("api_version").notNull(),
    // The blog new articles are created in. null: the store's "news" blog,
    // else its first blog.
    blogId: text("blog_id"),
    // Approving a draft also creates and publishes it. Off until a person turns
    // it on, which is only allowed once a real publish has gone through.
    autoPublish: boolean("auto_publish").notNull().default(false),
    connectedByUserId: text("connected_by_user_id").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("shopify_connections_project_idx").on(table.projectId),
    index("shopify_connections_organization_idx").on(table.organizationId),
  ],
);

// What the project's homepage said about its platform, checked once and kept.
// Shopify cards stay out of the way unless this finds Shopify, a person says it
// is one, or a store is already connected.
export const projectStorePlatforms = pgTable("project_store_platforms", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  // The domain that was fetched; a changed project domain makes this stale.
  checkedDomain: text("checked_domain").notNull(),
  // "unknown": the homepage could not be read, so nothing was concluded.
  detection: text("detection", {
    enum: ["shopify", "not_shopify", "unknown"],
  }).notNull(),
  // The marker that matched, e.g. "cdn.shopify.com".
  evidence: text("evidence"),
  checkedAt: text("checked_at").notNull(),
  // A person said this is a Shopify store (headless and custom-domain stores
  // can hide every marker).
  manualShopify: boolean("manual_shopify").notNull().default(false),
});

// A candidate piece of search work, with the numbers that justified it so every
// recommendation can show its evidence.
export const contentOpportunities = pgTable(
  "content_opportunities",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // query + page, so re-running extraction updates rather than duplicates.
    dedupeKey: text("dedupe_key").notNull(),
    query: text("query").notNull(),
    pageUrl: text("page_url"),
    impressions: integer("impressions").notNull(),
    clicks: integer("clicks").notNull(),
    ctr: real("ctr").notNull(),
    position: real("position").notNull(),
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    recommendedAction: text("recommended_action", {
      enum: [
        "new_article",
        "refresh_existing_page",
        "update_collection_page",
        "improve_title_and_meta",
        "create_page",
        "improve_internal_links",
        "technical_fix",
        "earn_third_party_coverage",
        "review_brand_information",
        "no_action",
      ],
    }).notNull(),
    // Plain-language reason naming the rule and thresholds that fired.
    reason: text("reason").notNull(),
    matchedCollectionHandle: text("matched_collection_handle"),
    // "gsc" for a real connected property, "simulated" for fixture data.
    dataSource: text("data_source", {
      enum: [
        "gsc",
        "simulated",
        "dataforseo",
        "serp",
        "competitor",
        "shopify",
        "site_audit",
        "ai_visibility",
        "attribution",
        "claim_correction",
      ],
    }).notNull(),
    // Buyer intent as the rules read it, and an explainable priority: the
    // level plus the sentence naming the numbers behind it.
    intent: text("intent"),
    priority: text("priority", { enum: ["high", "medium", "low"] }),
    priorityReason: text("priority_reason"),
    observedAt: text("observed_at"),
    status: text("status", { enum: ["open", "briefed", "dismissed"] })
      .notNull()
      .default("open"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("content_opportunities_dedupe_idx").on(
      table.projectId,
      table.dedupeKey,
    ),
    index("content_opportunities_org_idx").on(table.organizationId),
  ],
);

export const contentAssets = pgTable(
  "content_assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id").references(
      () => contentOpportunities.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    searchIntent: text("search_intent").notNull(),
    briefMarkdown: text("brief_markdown").notNull(),
    importedFrom: text("imported_from"),
    importWarning: text("import_warning"),
    bodyHtml: text("body_html").notNull(),
    metaTitle: text("meta_title").notNull(),
    metaDescription: text("meta_description").notNull(),
    // "template" drafts are deterministic and flagged as such in the UI;
    // "llm" drafts came from a model call that was explicitly requested.
    generator: text("generator", { enum: ["template", "llm"] }).notNull(),
    status: text("status", {
      enum: ["draft", "approved", "published", "failed"],
    })
      .notNull()
      .default("draft"),
    // Bumped on every edit; approval and publication are bound to a revision.
    revision: integer("revision").notNull().default(1),
    reviewerUserId: text("reviewer_user_id"),
    approvedByUserId: text("approved_by_user_id"),
    approvedRevision: integer("approved_revision"),
    approvedAt: text("approved_at"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    index("content_assets_project_idx").on(table.projectId),
    index("content_assets_opportunity_idx").on(table.opportunityId),
  ],
);

// Store products and collections a draft mentions, so quality checks can
// confirm each one exists and was available when the draft was made.
export const contentAssetReferences = pgTable(
  "content_asset_references",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    refType: text("ref_type", { enum: ["product", "collection"] }).notNull(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    available: boolean("available").notNull(),
  },
  (table) => [
    uniqueIndex("content_asset_references_unique_idx").on(
      table.assetId,
      table.refType,
      table.handle,
    ),
  ],
);

export const contentQualityChecks = pgTable(
  "content_quality_checks",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    checkKey: text("check_key").notNull(),
    // "block" failures prevent approval; "warn" failures are shown only.
    severity: text("severity", { enum: ["block", "warn"] }).notNull(),
    passed: boolean("passed").notNull(),
    detail: text("detail").notNull(),
  },
  (table) => [
    uniqueIndex("content_quality_checks_unique_idx").on(
      table.assetId,
      table.revision,
      table.checkKey,
    ),
  ],
);

// Every revision's text, so an edit never destroys the earlier version and a
// published or approved revision can be shown exactly as it was.
export const contentAssetVersions = pgTable(
  "content_asset_versions",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    bodyHtml: text("body_html").notNull(),
    metaTitle: text("meta_title").notNull(),
    metaDescription: text("meta_description").notNull(),
    editedByUserId: text("edited_by_user_id"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("content_asset_versions_unique_idx").on(
      table.assetId,
      table.revision,
    ),
  ],
);

// One row per publish attempt target. `idempotencyKey` is unique, so a retried
// job or a double click can never create a second Shopify article.
export const contentPublications = pgTable(
  "content_publications",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    connector: text("connector", { enum: ["shopify"] }).notNull(),
    mode: text("mode", { enum: ["live", "simulated"] }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    state: text("state", {
      enum: ["pending", "draft_created", "published", "failed"],
    }).notNull(),
    error: text("error"),
    requestedByUserId: text("requested_by_user_id").notNull(),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("content_publications_idempotency_idx").on(
      table.idempotencyKey,
    ),
    index("content_publications_asset_idx").on(table.assetId),
  ],
);

// Provider spend caused by content work (LLM drafting today). Written before
// a provider call is allowed to count against the project's cap.
export const contentProviderCosts = pgTable(
  "content_provider_costs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: text("asset_id").references(() => contentAssets.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    costUsd: real("cost_usd").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [index("content_provider_costs_project_idx").on(table.projectId)],
);

// ---------------------------------------------------------------------------
// Change ledger: one durable record per proposed or executed SEO change. It is
// provider-neutral (Shopify now; WordPress, technical fixes and AI visibility
// experiments use the same rows). Observations beside a change are recorded
// before/after measurements, never proof of cause.
// ---------------------------------------------------------------------------

export const changeLedgerEntries = pgTable(
  "change_ledger_entries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id").references(
      () => contentOpportunities.id,
      { onDelete: "set null" },
    ),
    kind: text("kind", {
      enum: [
        "content_article_create",
        "content_article_update",
        "metadata_update",
        "internal_link",
        "technical_fix",
        "ai_visibility_experiment",
        "link_acquired",
      ],
    }).notNull(),
    provider: text("provider", {
      enum: ["shopify", "wordpress", "google_tag_manager", "manual", "none"],
    }).notNull(),
    status: text("status", {
      enum: [
        "proposed",
        "approved",
        "rejected",
        "executing",
        "executed",
        "failed",
        "rolled_back",
        "abandoned",
      ],
    })
      .notNull()
      .default("proposed"),
    publicationStatus: text("publication_status", {
      enum: ["not_started", "draft", "published", "failed"],
    })
      .notNull()
      .default("not_started"),
    targetUrl: text("target_url"),
    // The content asset (or other internal object) the change is about.
    contentAssetId: text("content_asset_id").references(
      () => contentAssets.id,
      {
        onDelete: "set null",
      },
    ),
    contentRevision: integer("content_revision"),
    // The provider's id for the object the change created or edited.
    externalId: text("external_id"),
    proposedAction: text("proposed_action").notNull(),
    // Frozen text of the target before and after. After-state is what was
    // proposed; diff is what was actually applied.
    beforeState: text("before_state"),
    afterState: text("after_state"),
    diff: text("diff"),
    requestedByUserId: text("requested_by_user_id").notNull(),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: text("approved_at"),
    // The revision a person approved; execution refuses any other.
    approvedRevision: integer("approved_revision"),
    executedByUserId: text("executed_by_user_id"),
    executedAt: text("executed_at"),
    error: text("error"),
    rollbackKind: text("rollback_kind", {
      enum: ["none", "restore_previous_content", "unpublish", "manual"],
    })
      .notNull()
      .default("none"),
    // What a rollback needs (for example the previous article body).
    rollbackPayload: text("rollback_payload"),
    rolledBackAt: text("rolled_back_at"),
    rolledBackByUserId: text("rolled_back_by_user_id"),
    // The plan for judging the change later: which metric, how many days
    // after execution, and the baseline window the "before" reading covers.
    measurementMetric: text("measurement_metric"),
    measurementWindowDays: integer("measurement_window_days"),
    baselineStart: text("baseline_start"),
    baselineEnd: text("baseline_end"),
    finalDecision: text("final_decision"),
    finalDecidedByUserId: text("final_decided_by_user_id"),
    finalDecidedAt: text("final_decided_at"),
    // One entry per project + asset revision + action, so a retry or a
    // double click never creates a second record or a second execution.
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("change_ledger_entries_idempotency_idx").on(
      table.projectId,
      table.idempotencyKey,
    ),
    index("change_ledger_entries_project_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("change_ledger_entries_opportunity_idx").on(table.opportunityId),
  ],
);

// The evidence the proposal rested on, copied at proposal time so later
// changes to the opportunity never rewrite why the change was made.
export const changeLedgerEvidence = pgTable(
  "change_ledger_evidence",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => changeLedgerEntries.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    url: text("url"),
    observedAt: text("observed_at"),
  },
  (table) => [index("change_ledger_evidence_entry_idx").on(table.entryId)],
);

// Follow-up readings. "baseline" is taken at or before execution, "follow_up"
// after. Each is an observation with its window and denominator; none carries
// a causal claim.
export const changeLedgerObservations = pgTable(
  "change_ledger_observations",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => changeLedgerEntries.id, { onDelete: "cascade" }),
    phase: text("phase", { enum: ["baseline", "follow_up"] }).notNull(),
    source: text("source", {
      enum: ["gsc", "ga4", "ai_visibility", "manual"],
    }).notNull(),
    metric: text("metric").notNull(),
    value: real("value").notNull(),
    // For rates, value = numerator / denominator, both kept.
    numerator: real("numerator"),
    denominator: real("denominator"),
    windowStart: text("window_start"),
    windowEnd: text("window_end"),
    observedAt: text("observed_at").notNull(),
    aiRunId: text("ai_run_id"),
    note: text("note"),
  },
  (table) => [index("change_ledger_observations_entry_idx").on(table.entryId)],
);

// Estimated and actual provider spend, by project and optionally by change.
export const providerCosts = pgTable(
  "provider_costs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ledgerEntryId: text("ledger_entry_id").references(
      () => changeLedgerEntries.id,
      { onDelete: "set null" },
    ),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    estimatedUsd: real("estimated_usd"),
    costUsd: real("cost_usd").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("provider_costs_project_idx").on(table.projectId, table.createdAt),
  ],
);

// What a provider call did when it was not a normal read: a failure a service
// caught and turned into a refusal, and the weekly canary's own checks. Read
// it with a D1 query; it is not shown to customers. No foreign keys: it must
// outlive the project it was recorded for.
export const providerHealthEvents = pgTable(
  "provider_health_events",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull().default(isoNow),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    source: text("source", { enum: ["service", "canary"] }).notNull(),
    ok: boolean("ok").notNull(),
    kind: text("kind"),
    httpStatus: integer("http_status"),
    message: text("message"),
    organizationId: text("organization_id"),
    projectId: text("project_id"),
  },
  (table) => [
    index("provider_health_events_created_idx").on(table.createdAt),
    index("provider_health_events_operation_idx").on(
      table.operation,
      table.createdAt,
    ),
  ],
);

// Who changed what, for owners and admins. Append-only: nothing edits or
// deletes a row except the retention sweep. No foreign keys, so the record
// outlives the project or member it describes.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull().default(isoNow),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id"),
    actorKind: text("actor_kind", {
      enum: ["user", "agent", "system"],
    }).notNull(),
    actorUserId: text("actor_user_id"),
    // The email at the time, so the row still reads after the account is gone.
    actorLabel: text("actor_label"),
    // The connected client for an agent, such as a chat app.
    actorClient: text("actor_client"),
    action: text("action").notNull(),
    targetKind: text("target_kind"),
    targetId: text("target_id"),
    summary: text("summary").notNull(),
    outcome: text("outcome", {
      enum: ["success", "refused", "failed"],
    }).notNull(),
  },
  (table) => [
    index("audit_events_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("audit_events_org_action_idx").on(
      table.organizationId,
      table.action,
      table.createdAt,
    ),
  ],
);

// Optional ceilings. Null means no limit of that kind.
export const projectSpendLimits = pgTable("project_spend_limits", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  dailyUsd: real("daily_usd"),
  monthlyUsd: real("monthly_usd"),
  scheduledJobsPerDay: integer("scheduled_jobs_per_day"),
  updatedByUserId: text("updated_by_user_id").notNull(),
  updatedAt: text("updated_at").notNull().default(isoNow),
});

// Why an opportunity exists: each row is one observation behind it, with its
// source and when it was read.
export const opportunityEvidence = pgTable(
  "opportunity_evidence",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => contentOpportunities.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    url: text("url"),
    observedAt: text("observed_at"),
  },
  (table) => [
    index("opportunity_evidence_opportunity_idx").on(table.opportunityId),
  ],
);

export const contentRefreshJobs = pgTable(
  "content_refresh_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => contentOpportunities.id, { onDelete: "cascade" }),
    batchId: text("batch_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    status: text("status", {
      enum: ["queued", "running", "ready", "failed"],
    }).notNull(),
    reason: text("reason"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("content_refresh_jobs_project_opportunity").on(
      t.projectId,
      t.opportunityId,
    ),
    index("content_refresh_jobs_batch").on(t.batchId),
    index("content_refresh_jobs_status_time").on(t.status, t.updatedAt),
  ],
);
