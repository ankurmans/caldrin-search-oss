import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { DISMISSAL_KINDS } from "@/shared/competitor-dismissal";
import { projects } from "./app.schema";

// Timestamps are stored as *text* (same column shape as the SQLite schema); see
// the note in pg/app.schema.ts. `isoNow` matches `new Date().toISOString()` so
// DB-defaulted and app-written values sort together lexicographically.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ============================================================================
// Project memory: the shared AI context every surface (SAM, MCP, settings UI)
// reads and writes. Prose lives in the sections table; list-shaped knowledge is
// normalized so it stays joinable instead of buried in markdown.
// ============================================================================

// One row per (project, section). `key` is either a typed key
// ("business_overview", "current_goal", "positioning", "writing_preferences")
// or "custom:<slug>" for an agent-created section, in which case `title` holds
// its display name.
export const projectContextSections = pgTable(
  "project_context_sections",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    updatedAt: text("updated_at").notNull().default(isoNow),
    updatedBy: text("updated_by", { enum: ["user", "sam", "mcp"] }).notNull(),
  },
  // The composite PK is project-leading, so it also serves the "load every
  // section for this project" read.
  (table) => [primaryKey({ columns: [table.projectId, table.key] })],
);

export const projectCompetitors = pgTable(
  "project_competitors",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Normalized bare host (lowercase, no protocol/www), so agents adding the
    // same competitor from different surfaces upsert onto one row.
    domain: text("domain").notNull(),
    name: text("name"),
    notes: text("notes"),
    source: text("source", { enum: ["manual", "discovered"] })
      .notNull()
      .default("manual"),
    lastAnalysedAt: text("last_analysed_at"),
    updatedAt: text("updated_at").notNull().default(isoNow),
    updatedBy: text("updated_by", { enum: ["user", "sam", "mcp"] }).notNull(),
  },
  (table) => [
    uniqueIndex("project_competitors_project_domain_idx").on(
      table.projectId,
      table.domain,
    ),
  ],
);
// Domains a person ruled out as competitors for a project, with why. Discovery
// leaves them out of the competitor list; they stay eligible as link
// prospects, so this is not a blocklist for the rest of the product.
export const competitorDismissals = pgTable(
  "competitor_dismissals",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Normalized bare host, as in project_competitors.
    domain: text("domain").notNull(),
    kind: text("kind", { enum: DISMISSAL_KINDS }).notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.domain] })],
);

// The markets a competitor is compared in. A competitor with no rows here is
// compared in the project's own market.
export const projectCompetitorMarkets = pgTable(
  "project_competitor_markets",
  {
    competitorId: text("competitor_id")
      .notNull()
      .references(() => projectCompetitors.id, { onDelete: "cascade" }),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.competitorId, table.locationCode, table.languageCode],
    }),
  ],
);

// One paid keyword gap read: the target against up to five competitors in one
// market. The run is the observation; its rows are never rewritten, so the page
// can show what was read and when without asking the provider again.
export const keywordGapRuns = pgTable(
  "keyword_gap_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    targetDomain: text("target_domain").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    // Per competitor, how many keywords were asked for.
    rowsPerCompetitor: integer("rows_per_competitor").notNull(),
    includeOutranked: boolean("include_outranked").notNull(),
    estimatedUsd: real("estimated_usd").notNull(),
    costUsd: real("cost_usd").notNull(),
    status: text("status", {
      enum: ["complete", "partial", "failed"],
    }).notNull(),
    rowCount: integer("row_count").notNull(),
    createdBy: text("created_by", { enum: ["user", "sam", "mcp"] }).notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("keyword_gap_runs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

// What the provider returned for each competitor in a run, so the page can say
// "read 100 of 4,210" instead of implying a complete keyword universe.
export const keywordGapRunCompetitors = pgTable(
  "keyword_gap_run_competitors",
  {
    runId: text("run_id")
      .notNull()
      .references(() => keywordGapRuns.id, { onDelete: "cascade" }),
    competitorDomain: text("competitor_domain").notNull(),
    kind: text("kind", { enum: ["missing", "outranked"] }).notNull(),
    status: text("status", { enum: ["ok", "failed"] }).notNull(),
    rowsRead: integer("rows_read").notNull(),
    // The provider's own count of matching keywords, when it reported one.
    providerTotal: integer("provider_total"),
    error: text("error"),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.competitorDomain, table.kind],
    }),
  ],
);

export const keywordGapRows = pgTable(
  "keyword_gap_rows",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => keywordGapRuns.id, { onDelete: "cascade" }),
    // Repeated so every read is scoped to a project without a join.
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    // "missing": no competitor read here has the target ranking for it.
    // "outranked": the target ranks, a competitor ranks higher.
    kind: text("kind", { enum: ["missing", "outranked"] }).notNull(),
    searchVolume: integer("search_volume"),
    keywordDifficulty: integer("keyword_difficulty"),
    cpc: real("cpc"),
    intent: text("intent"),
    // How many of the compared competitors rank for it.
    competitorCount: integer("competitor_count").notNull(),
    bestPosition: integer("best_position").notNull(),
    bestDomain: text("best_domain").notNull(),
    bestUrl: text("best_url"),
    bestTraffic: real("best_traffic"),
    targetPosition: integer("target_position"),
    targetUrl: text("target_url"),
    // The provider's own date for the keyword data, else the run time.
    observedAt: text("observed_at").notNull(),
  },
  (table) => [
    uniqueIndex("keyword_gap_rows_run_keyword_idx").on(
      table.runId,
      table.keyword,
    ),
    index("keyword_gap_rows_project_run_idx").on(table.projectId, table.runId),
  ],
);

export const keywordGapPositions = pgTable(
  "keyword_gap_positions",
  {
    rowId: text("row_id")
      .notNull()
      .references(() => keywordGapRows.id, { onDelete: "cascade" }),
    competitorDomain: text("competitor_domain").notNull(),
    position: integer("position").notNull(),
    url: text("url"),
    traffic: real("traffic"),
  },
  (table) => [primaryKey({ columns: [table.rowId, table.competitorDomain] })],
);

// What the team decided about a keyword. It outlives any single run, so a
// dismissed keyword stays dismissed when the gap is read again.
export const keywordGapDecisions = pgTable(
  "keyword_gap_decisions",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    status: text("status", { enum: ["active", "watching", "dismissed"] })
      .notNull()
      .default("active"),
    // The page on this site meant to win the keyword, when one was chosen.
    targetPageUrl: text("target_page_url"),
    // The opportunity created from this keyword, if any.
    opportunityId: text("opportunity_id"),
    updatedAt: text("updated_at").notNull().default(isoNow),
    updatedBy: text("updated_by", { enum: ["user", "sam", "mcp"] }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.projectId,
        table.keyword,
        table.locationCode,
        table.languageCode,
      ],
    }),
  ],
);

// A saved table view: filters, sort and visible columns for one table, kept
// per project so a team opens the same view.
export const savedTableViews = pgTable(
  "saved_table_views",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tableKey: text("table_key").notNull(),
    name: text("name").notNull(),
    // Opaque UI configuration, validated by the table that owns it.
    config: text("config").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("saved_table_views_project_table_name_idx").on(
      table.projectId,
      table.tableKey,
      table.name,
    ),
  ],
);

// A curated shortlist of pages that matter, NOT a page inventory — the
// inventory lives in audit_pages and GSC.
export const projectKeyPages = pgTable(
  "project_key_pages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    role: text("role", { enum: ["hub", "spoke", "money", "other"] }).notNull(),
    topic: text("topic"),
    notes: text("notes"),
    updatedAt: text("updated_at").notNull().default(isoNow),
    updatedBy: text("updated_by", { enum: ["user", "sam", "mcp"] }).notNull(),
  },
  (table) => [
    uniqueIndex("project_key_pages_project_url_idx").on(
      table.projectId,
      table.url,
    ),
  ],
);

// What research has already been bought and what it concluded, so SAM and
// Claude Code stop re-buying the same paid research. Pruned to 90 days on
// append; the date is server-stamped, never supplied by the caller.
export const projectResearchLog = pgTable(
  "project_research_log",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entryDate: text("entry_date").notNull(),
    summary: text("summary").notNull(),
    createdBy: text("created_by", { enum: ["user", "sam", "mcp"] }).notNull(),
    // entry_date is a day stamp, so recency needs its own column — same-day
    // entries would otherwise tie-break on a random uuid.
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("project_research_log_project_date_idx").on(
      table.projectId,
      table.entryDate,
    ),
  ],
);
