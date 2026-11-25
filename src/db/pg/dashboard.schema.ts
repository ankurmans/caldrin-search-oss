import {
  pgTable,
  text,
  doublePrecision,
  integer,
  primaryKey,
  index,
  bigint,
} from "drizzle-orm/pg-core";
import type {
  FirstReadKind,
  FirstReadSearchConsole,
} from "@/shared/first-read";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

export const dataRefreshClaims = pgTable("data_refresh_claims", {
  key: text("key").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  nextAttemptAt: bigint("next_attempt_at", { mode: "number" }).notNull(),
});

export const projectFirstReads = pgTable(
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

export const projectFirstReadFindings = pgTable(
  "project_first_read_findings",
  {
    readKey: text("read_key")
      .notNull()
      .references(() => projectFirstReads.key, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    kind: text("kind").$type<FirstReadKind>().notNull(),
    subject: text("subject").notNull(),
    metric: doublePrecision("metric").notNull(),
    relatedMetric: doublePrecision("related_metric"),
    page: text("page"),
    observedAt: text("observed_at").notNull(),
    rangeStart: text("range_start"),
    rangeEnd: text("range_end"),
  },
  (t) => [primaryKey({ columns: [t.readKey, t.rank] })],
);
