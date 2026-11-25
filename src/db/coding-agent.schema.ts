import {
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  sqliteTable,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";

export const codingAgentPanels = sqliteTable(
  "coding_agent_panels",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    mode: text("mode", {
      enum: ["search_disabled", "brokered_search", "documentation_index"],
    }).notNull(),
    prompt: text("prompt").notNull(),
    model: text("model").notNull(),
    capturedAt: text("captured_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    index("coding_agent_panels_project_capture_idx").on(
      t.projectId,
      t.capturedAt,
    ),
  ],
);

export const codingAgentRuns = sqliteTable(
  "coding_agent_runs",
  {
    projectId: text("project_id").notNull(),
    panelId: text("panel_id").notNull(),
    slot: integer("slot").notNull(),
    answer: text("answer").notNull(),
    query: text("query"),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    listRateMicroUsd: integer("list_rate_micro_usd").notNull(),
    lookupCostMicroUsd: integer("lookup_cost_micro_usd"),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.panelId, t.slot] }),
    foreignKey({
      columns: [t.projectId, t.panelId],
      foreignColumns: [codingAgentPanels.projectId, codingAgentPanels.id],
    }).onDelete("cascade"),
  ],
);

export const codingAgentSources = sqliteTable(
  "coding_agent_sources",
  {
    projectId: text("project_id").notNull(),
    panelId: text("panel_id").notNull(),
    slot: integer("slot").notNull(),
    url: text("url").notNull(),
    evidence: text("evidence", { enum: ["returned", "answer_link"] }).notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.projectId, t.panelId, t.slot, t.url, t.evidence],
    }),
    foreignKey({
      columns: [t.projectId, t.panelId, t.slot],
      foreignColumns: [
        codingAgentRuns.projectId,
        codingAgentRuns.panelId,
        codingAgentRuns.slot,
      ],
    }).onDelete("cascade"),
  ],
);
