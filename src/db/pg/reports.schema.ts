import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  primaryKey,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

// Timestamps are stored as *text* (same column shape as the SQLite schema); see
// the note in pg/app.schema.ts. `isoNow` matches `new Date().toISOString()` so
// DB-defaulted and app-written values sort together lexicographically.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// Postgres mirror of the reports table. Column notes: see ../reports.schema.ts.
export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    html: text("html").notNull(),
    skill: text("skill"),
    templateId: text("template_id"),
    createdBy: text("created_by").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    shareToken: text("share_token"),
    sharedAt: text("shared_at"),
    clientVisible: boolean("client_visible").notNull().default(false),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    index("reports_project_updated_idx").on(
      table.projectId,
      table.updatedAt,
      table.id,
      table.sizeBytes,
    ),
    uniqueIndex("reports_share_token_idx").on(table.shareToken),
  ],
);

export const marketReportSchedules = pgTable(
  "market_report_schedules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    cadence: integer("cadence").notNull(),
    days: integer("days").notNull(),
    nextRunAt: text("next_run_at").notNull(),
    lastStatus: text("last_status"),
    lastReportId: text("last_report_id"),
  },
  (t) => [
    uniqueIndex("market_report_schedule_project_user").on(
      t.projectId,
      t.userId,
    ),
    index("market_report_next_run").on(t.nextRunAt),
  ],
);

export const marketReportScheduleMarkets = pgTable(
  "market_report_schedule_markets",
  {
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => marketReportSchedules.id, { onDelete: "cascade" }),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scheduleId, t.locationCode, t.languageCode] }),
  ],
);
