import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { attributionEvents } from "./attribution.schema";

// Everything below is derived from the ledger in attribution.schema.ts and can
// be wiped and rebuilt from it without changing an event.

// Every identity seen, and the subject (a connected group of identities)
// it currently belongs to.
export const attributionIdentityNodes = sqliteTable(
  "attribution_identity_nodes",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    nodeType: text("node_type").notNull(),
    nodeValue: text("node_value").notNull(),
    subjectId: text("subject_id").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.nodeType, t.nodeValue] }),
    index("attribution_nodes_subject_idx").on(t.projectId, t.subjectId),
  ],
);

// An accepted or refused join between two identities, and the event that
// justified it. A refused join (status "conflict") never merges subjects.
export const attributionIdentityLinks = sqliteTable(
  "attribution_identity_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    aType: text("a_type").notNull(),
    aValue: text("a_value").notNull(),
    bType: text("b_type").notNull(),
    bValue: text("b_value").notNull(),
    // active, or conflict when joining would have put two different users in one subject.
    status: text("status").notNull(),
    evidenceEventId: text("evidence_event_id")
      .notNull()
      .references(() => attributionEvents.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("attribution_links_pair_idx").on(
      t.projectId,
      t.aType,
      t.aValue,
      t.bType,
      t.bValue,
    ),
    index("attribution_links_a_idx").on(t.projectId, t.aType, t.aValue),
    index("attribution_links_b_idx").on(t.projectId, t.bType, t.bValue),
  ],
);

// A moment a source was recorded for someone: a session's landing, or a
// source the buyer reported. `anchor_*` is the identity it belongs to.
export const attributionTouchpoints = sqliteTable(
  "attribution_touchpoints",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => attributionEvents.id, { onDelete: "cascade" }),
    // session, self_reported or call.
    kind: text("kind").notNull(),
    anchorType: text("anchor_type").notNull(),
    anchorValue: text("anchor_value").notNull(),
    sessionId: text("session_id"),
    propertyId: text("property_id"),
    brandId: text("brand_id"),
    occurredAt: text("occurred_at").notNull(),
    channel: text("channel").notNull(),
    source: text("source"),
    // The rule that classified it, so the classification can be inspected.
    ruleId: text("rule_id").notNull(),
    landingHost: text("landing_host"),
    landingPath: text("landing_path"),
    referrerHost: text("referrer_host"),
    utmCampaign: text("utm_campaign"),
    selfReportedText: text("self_reported_text"),
  },
  (t) => [
    index("attribution_touchpoints_anchor_idx").on(
      t.projectId,
      t.anchorType,
      t.anchorValue,
      t.occurredAt,
    ),
    index("attribution_touchpoints_time_idx").on(
      t.projectId,
      t.channel,
      t.occurredAt,
    ),
    index("attribution_touchpoints_event_idx").on(t.eventId),
  ],
);

// A snapshot of the model configuration credits were computed under, so a
// number can be reproduced and a change to the rules is visible.
export const attributionModelRuns = sqliteTable(
  "attribution_model_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    modelVersion: text("model_version").notNull(),
    lookbackDays: integer("lookback_days").notNull(),
    // The model parameters and source rule fingerprint, as JSON.
    parameters: text("parameters").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("attribution_runs_project_idx").on(t.projectId, t.createdAt)],
);

// An outcome worth attributing, derived from one event. `subject_id` is the
// identity group it currently belongs to; revenue is net of linked refunds.
export const attributionConversions = sqliteTable(
  "attribution_conversions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => attributionEvents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    subjectId: text("subject_id").notNull(),
    occurredAt: text("occurred_at").notNull(),
    brandId: text("brand_id"),
    propertyId: text("property_id"),
    amountMinor: integer("amount_minor"),
    grossMinor: integer("gross_minor"),
    currency: text("currency"),
    isFirstPayment: integer("is_first_payment", { mode: "boolean" })
      .notNull()
      .default(false),
    // Copied from the event's import batch, so demo outcomes never reach a real report.
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("attribution_conversions_event_idx").on(t.eventId),
    index("attribution_conversions_kind_idx").on(
      t.projectId,
      t.kind,
      t.occurredAt,
    ),
    index("attribution_conversions_subject_idx").on(t.projectId, t.subjectId),
  ],
);

// The credit each model gives each touchpoint for a conversion, in basis
// points. A conversion with no source evidence gets one `unknown` credit of
// 10000: unknown outcomes are kept, never handed to a known channel.
export const attributionCredits = sqliteTable(
  "attribution_credits",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversionId: text("conversion_id")
      .notNull()
      .references(() => attributionConversions.id, { onDelete: "cascade" }),
    modelKey: text("model_key").notNull(),
    runId: text("run_id").notNull(),
    touchpointId: text("touchpoint_id"),
    channel: text("channel").notNull(),
    source: text("source"),
    creditBp: integer("credit_bp").notNull(),
    // observed, linked, self_reported, modelled or unknown.
    evidence: text("evidence").notNull(),
    // Copied from the conversion so a dashboard reads one table.
    conversionKind: text("conversion_kind").notNull(),
    occurredAt: text("occurred_at").notNull(),
    brandId: text("brand_id"),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
  },
  (t) => [
    index("attribution_credits_model_idx").on(
      t.projectId,
      t.modelKey,
      t.conversionKind,
      t.occurredAt,
    ),
    index("attribution_credits_conversion_idx").on(t.conversionId, t.modelKey),
  ],
);

// Project-level rules that classify a recorded referrer, campaign tag or
// click id into a channel, ahead of the built-in rules.
export const attributionSourceRules = sqliteTable(
  "attribution_source_rules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // referrer_host, utm_source, utm_medium or click_id.
    matchKind: text("match_kind").notNull(),
    pattern: text("pattern").notNull(),
    channel: text("channel").notNull(),
    sourceLabel: text("source_label").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("attribution_rules_match_idx").on(
      t.projectId,
      t.matchKind,
      t.pattern,
    ),
  ],
);

// Accepted and refused events per day, for the daily limit and the health view.
export const attributionIngestCounters = sqliteTable(
  "attribution_ingest_counters",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    accepted: integer("accepted").notNull().default(0),
    rejected: integer("rejected").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.day] })],
);

// Events waiting to be turned into touchpoints, conversions and credits.
// Ingest queues each event; a drain works the queue oldest first, so a large
// import or a reprocess is the same path as a single live event and can stop
// and resume. `position` is the event's ingestion time: replaying in that
// order rebuilds the same identity graph the live path built.
export const attributionPending = sqliteTable(
  "attribution_pending",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => attributionEvents.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: text("position").notNull(),
  },
  (t) => [index("attribution_pending_queue_idx").on(t.projectId, t.position)],
);
