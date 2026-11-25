import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// Mirrors src/db/monitoring.schema.ts; see it for what each table holds.
// Timestamps are ISO-8601 text written by the app (see pg/app.schema.ts).

export const alertDestinations = pgTable("alert_destinations", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  emailEnabled: boolean("email_enabled").notNull().default(false),
  slackWebhookSealed: text("slack_webhook_sealed"),
  updatedAt: text("updated_at").notNull(),
});

export const projectAlerts = pgTable(
  "project_alerts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "visibility_change",
        "competitor_change",
        "source_change",
        "run_failed",
        "budget_blocked",
        "weekly_summary",
      ],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    detailsJson: text("details_json").notNull(),
    comparable: boolean("comparable").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: text("created_at").notNull(),
    readAt: text("read_at"),
    emailedAt: text("emailed_at"),
  },
  (t) => [
    uniqueIndex("project_alerts_project_dedupe_idx").on(
      t.projectId,
      t.dedupeKey,
    ),
    index("project_alerts_project_created_idx").on(t.projectId, t.createdAt),
  ],
);

export const monitoringJobRuns = pgTable(
  "monitoring_job_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    job: text("job").notNull(),
    status: text("status", {
      enum: ["succeeded", "failed", "skipped"],
    }).notNull(),
    reason: text("reason"),
    attempt: integer("attempt").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    uniqueIndex("monitoring_job_runs_idempotency_idx").on(t.idempotencyKey),
    index("monitoring_job_runs_project_idx").on(t.projectId, t.startedAt),
  ],
);
