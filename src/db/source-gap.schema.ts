import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { aiPrompts } from "./ai-visibility.schema";

// Source Gap Analysis: why the pages AI answers cited beat the project's own
// page for one tracked prompt. Everything here is derived from stored answers
// and pages fetched for the comparison; no AI query is run.

// One fetch of one public page, kept so an analysis can say exactly which
// version of each page it compared and how old that copy was. A re-fetch whose
// content hash is unchanged only moves `fetched_at`; changed content is a new
// row, so earlier analyses keep the page they saw.
export const sourcePageSnapshots = sqliteTable(
  "source_page_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    // Tracking parameters and fragments removed, host lower-cased.
    normalizedUrl: text("normalized_url").notNull(),
    status: text("status", {
      enum: [
        "ok",
        "blocked_by_robots",
        "challenge",
        "not_found",
        "http_error",
        "unreachable",
        "not_html",
        "homepage_only",
        "skipped",
      ],
    }).notNull(),
    httpStatus: integer("http_status"),
    fetchedAt: text("fetched_at").notNull(),
    // SHA-256 of the visible text; null when nothing was read.
    contentHash: text("content_hash"),
    rendered: integer("rendered", { mode: "boolean" }).notNull(),
    // ParsedPage as JSON; null unless status is "ok".
    parsedJson: text("parsed_json"),
    note: text("note"),
  },
  (t) => [
    index("source_page_snapshots_project_url_idx").on(
      t.projectId,
      t.normalizedUrl,
      t.fetchedAt,
    ),
  ],
);

// One stored analysis of one prompt. Analyses are never overwritten: a new run
// adds a row that points at the one before it, so changes can be shown.
export const sourceGapAnalyses = sqliteTable(
  "source_gap_analyses",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => aiPrompts.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    previousAnalysisId: text("previous_analysis_id"),
    ownerUrl: text("owner_url"),
    ownerConfidence: text("owner_confidence", {
      enum: ["high", "medium", "low"],
    }),
    ownerOverridden: integer("owner_overridden", { mode: "boolean" }).notNull(),
    topRootCause: text("top_root_cause"),
    sourcesAnalyzed: integer("sources_analyzed").notNull(),
    collectionMode: text("collection_mode", {
      enum: ["api_benchmark", "scraper", "mixed"],
    }).notNull(),
    // The Search Opportunity made from this analysis, if any.
    opportunityId: text("opportunity_id"),
    // The full SourceGapAnalysis, with snapshots held by id.
    resultJson: text("result_json").notNull(),
  },
  (t) => [
    index("source_gap_analyses_prompt_created_idx").on(
      t.projectId,
      t.promptId,
      t.createdAt,
    ),
  ],
);

// The page a person chose as the owner of one prompt, used by later analyses
// instead of the automatic pick.
export const sourceGapOwnerOverrides = sqliteTable(
  "source_gap_owner_overrides",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => aiPrompts.id, { onDelete: "cascade" }),
    ownerUrl: text("owner_url").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("source_gap_owner_overrides_prompt_idx").on(
      t.projectId,
      t.promptId,
    ),
  ],
);
