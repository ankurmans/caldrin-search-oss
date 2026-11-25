import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";

// Revenue attribution. `attribution_events` is the immutable ledger of what
// source systems told us; everything else is either configuration or derived
// from the ledger and can be rebuilt from it without rewriting an event.

// One row per project. The defaults are the safe ones: events are only
// collected from visitors who consented, and nothing is read from a browser
// until the site says so.
export const attributionSettings = sqliteTable("attribution_settings", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  // "required": the tracker sends nothing until the site calls consent.
  // "implied": the site has decided consent is not needed for these events.
  consentMode: text("consent_mode").notNull().default("required"),
  // IANA zone the project's reporting days are cut in.
  timezone: text("timezone").notNull().default("UTC"),
  // Revenue in any other currency is kept and shown, never converted.
  reportingCurrency: text("reporting_currency").notNull().default("USD"),
  lookbackDays: integer("lookback_days").notNull().default(90),
  // Page views older than this are pruned; conversions are kept.
  retentionDays: integer("retention_days").notNull().default(395),
  dailyEventLimit: integer("daily_event_limit").notNull().default(200000),
  defaultModel: text("default_model").notNull().default("last_non_direct"),
  updatedAt: text("updated_at").notNull(),
});

// An operating brand under the project's parent company.
export const attributionBrands = sqliteTable(
  "attribution_brands",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("attribution_brands_slug_idx").on(t.projectId, t.slug)],
);

// A website the tracker runs on. Events from a host the project has not
// registered are refused.
export const attributionProperties = sqliteTable(
  "attribution_properties",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => attributionBrands.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    host: text("host").notNull(),
    createdAt: text("created_at").notNull(),
    // The first real (non-test) browser event, which is how installation is verified.
    verifiedAt: text("verified_at"),
    lastEventAt: text("last_event_at"),
  },
  (t) => [
    uniqueIndex("attribution_properties_host_idx").on(t.projectId, t.host),
  ],
);

// Write keys. "public" keys sit in the page and only start sessions and page
// views from a registered host; "secret" keys sign server-side events. Only
// the hash is stored; a key is shown once.
export const attributionKeys = sqliteTable(
  "attribution_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    // A public key sits in every page of the customer's site, so it is kept
    // readable to show the install snippet again. A secret key never is.
    publicValue: text("public_value"),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    uniqueIndex("attribution_keys_hash_idx").on(t.keyHash),
    index("attribution_keys_project_idx").on(t.projectId, t.kind),
  ],
);

// One import, webhook delivery or API call that brought events in.
export const attributionImportBatches = sqliteTable(
  "attribution_import_batches",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceSystem: text("source_system").notNull(),
    label: text("label").notNull(),
    // Demo batches are labelled in every view and removable as a unit.
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    receivedCount: integer("received_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
  },
  (t) => [
    index("attribution_batches_project_idx").on(t.projectId, t.createdAt),
  ],
);

// The ledger. A row is never updated: a correction is a new event. `source_*`
// say who reported it and under what id, so a webhook delivered twice, or a
// file imported twice, lands once.
export const attributionEvents = sqliteTable(
  "attribution_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    propertyId: text("property_id").references(() => attributionProperties.id, {
      onDelete: "set null",
    }),
    // The brand that received the event.
    brandId: text("brand_id").references(() => attributionBrands.id, {
      onDelete: "set null",
    }),
    // The brand the buyer meant, where the source says so and it differs.
    intendedBrandId: text("intended_brand_id").references(
      () => attributionBrands.id,
      { onDelete: "set null" },
    ),
    eventType: text("event_type").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    // browser, server, webhook or import.
    origin: text("origin").notNull(),
    // When it happened (UTC), against when we learned of it.
    occurredAt: text("occurred_at").notNull(),
    ingestedAt: text("ingested_at").notNull(),
    importBatchId: text("import_batch_id").references(
      () => attributionImportBatches.id,
      { onDelete: "set null" },
    ),
    sessionId: text("session_id"),
    landingHost: text("landing_host"),
    landingPath: text("landing_path"),
    pagePath: text("page_path"),
    // Host and path of the recorded referrer; its query string is never kept.
    referrerHost: text("referrer_host"),
    referrerPath: text("referrer_path"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    clickIdKind: text("click_id_kind"),
    clickId: text("click_id"),
    // What the buyer said brought them, in their words.
    selfReportedSource: text("self_reported_source"),
    // A funnel stage name or deal stage the source reported.
    stage: text("stage"),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    // The source id of the event this one adjusts (a refund's payment).
    parentSourceEventId: text("parent_source_event_id"),
    // Small raw fields, kept as the source sent them.
    payload: text("payload"),
    // The R2 key of a larger payload.
    payloadKey: text("payload_key"),
    // Marked by the test-event verifier or a source flag; counted in health, not in results.
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    isBot: integer("is_bot", { mode: "boolean" }).notNull().default(false),
    consent: text("consent").notNull().default("granted"),
  },
  (t) => [
    uniqueIndex("attribution_events_source_idx").on(
      t.projectId,
      t.sourceSystem,
      t.sourceEventId,
    ),
    index("attribution_events_time_idx").on(
      t.projectId,
      t.eventType,
      t.occurredAt,
    ),
    index("attribution_events_batch_idx").on(t.importBatchId),
    index("attribution_events_parent_idx").on(
      t.projectId,
      t.parentSourceEventId,
    ),
  ],
);

// The identifiers an event carried: a visitor id, an app user id, a billing
// customer id and so on. Identity links are built only from identifiers that
// arrived together on one event.
export const attributionEventIdentifiers = sqliteTable(
  "attribution_event_identifiers",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => attributionEvents.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    identifierType: text("identifier_type").notNull(),
    value: text("value").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.identifierType] }),
    index("attribution_identifiers_value_idx").on(
      t.projectId,
      t.identifierType,
      t.value,
    ),
  ],
);

// A row or event that was refused, and why: the raw material for the health
// view's invalid-import and webhook-failure counts. Short-lived and capped.
export const attributionRejections = sqliteTable(
  "attribution_rejections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    importBatchId: text("import_batch_id").references(
      () => attributionImportBatches.id,
      { onDelete: "cascade" },
    ),
    sourceSystem: text("source_system").notNull(),
    reason: text("reason").notNull(),
    detail: text("detail"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("attribution_rejections_project_idx").on(t.projectId, t.createdAt),
  ],
);
