import {
  sqliteTable,
  text,
  real,
  primaryKey,
  index,
  integer,
} from "drizzle-orm/sqlite-core";
import type {
  FirstReadKind,
  FirstReadSearchConsole,
} from "@/shared/first-read";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

export const dataRefreshClaims = sqliteTable("data_refresh_claims", {
  key: text("key").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  nextAttemptAt: integer("next_attempt_at").notNull(),
});

export const projectFirstReads = sqliteTable(
  "project_first_reads",
  {
    key: text("key").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    completedAt: text("completed_at").notNull(),
    searchConsole: text("search_console")
      .$type<FirstReadSearchConsole>()
      .notNull(),
  },
  (t) => [index("project_first_reads_project_idx").on(t.projectId)],
);

export const projectFirstReadFindings = sqliteTable(
  "project_first_read_findings",
  {
    readKey: text("read_key")
      .notNull()
      .references(() => projectFirstReads.key, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    kind: text("kind").$type<FirstReadKind>().notNull(),
    subject: text("subject").notNull(),
    metric: real("metric").notNull(),
    relatedMetric: real("related_metric"),
    page: text("page"),
    observedAt: text("observed_at").notNull(),
    rangeStart: text("range_start"),
    rangeEnd: text("range_end"),
  },
  (t) => [primaryKey({ columns: [t.readKey, t.rank] })],
);
