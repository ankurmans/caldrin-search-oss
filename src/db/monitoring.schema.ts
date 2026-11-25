import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// Automated monitoring of stored AI visibility data. The daily job only reads
// collected answers; it never starts a paid collection.

// One alert per change worth a look. `details_json` holds the facts behind the
// text (metric, before/after numerator and denominator, prompt-set version,
// engines, window dates, verdict) so the alert can be re-read without
// recomputing it. `comparable` is false only when the figures mix conditions.
export const projectAlerts = sqliteTable(
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
    // Plain text, never HTML.
    body: text("body").notNull(),
    detailsJson: text("details_json").notNull(),
    comparable: integer("comparable", { mode: "boolean" }).notNull(),
    // Same change, same key: a re-run never writes the alert twice.
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

// Where a workspace's new alerts go besides the app. No row means in-app only.
// The Slack webhook URL is a secret, so it is stored sealed.
export const alertDestinations = sqliteTable("alert_destinations", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  emailEnabled: integer("email_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  slackWebhookSealed: text("slack_webhook_sealed"),
  updatedAt: text("updated_at").notNull(),
});

// One row per monitoring job and period. The idempotency key is
// project + job + period, so a re-run in the same period is a no-op and a
// failing job stops after a fixed number of attempts.
export const monitoringJobRuns = sqliteTable(
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
