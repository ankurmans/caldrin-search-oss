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
import { projects } from "./app.schema";
import { aiPrompts } from "./ai-visibility.schema";
import {
  EXPERIMENT_ARMS,
  EXPERIMENT_STATUSES,
} from "@/shared/ai-perception-experiments";
import {
  PERCEPTION_SENTIMENTS,
  PERCEPTION_STANCES,
} from "@/shared/ai-perception";

// A tested page edit: the page text as it stands, the proposed edit, and what a
// model said about the brand when it was handed each version. A replay is a
// simulation with the page supplied as context, never an engine's own answer.
export const aiPerceptionExperiments = pgTable(
  "ai_perception_experiments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    originalText: text("original_text").notNull(),
    editedText: text("edited_text").notNull(),
    // What the person assumes about how the page reaches an answer.
    assumptions: text("assumptions").notNull(),
    repeats: integer("repeats").notNull(),
    status: text("status", { enum: EXPERIMENT_STATUSES }).notNull(),
    brandName: text("brand_name").notNull(),
    brandDomain: text("brand_domain").notNull(),
    model: text("model"),
    // The saved opportunity this experiment was approved into.
    opportunityId: text("opportunity_id"),
    costUsd: real("cost_usd").notNull(),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
    replayedAt: text("replayed_at"),
    approvedAt: text("approved_at"),
    // "person" or "agent": who sent the replay to Opportunities.
    approvedBy: text("approved_by", { enum: ["person", "agent"] }),
  },
  (t) => [index("ai_perception_experiments_project_idx").on(t.projectId)],
);

export const aiPerceptionExperimentPrompts = pgTable(
  "ai_perception_experiment_prompts",
  {
    experimentId: text("experiment_id")
      .notNull()
      .references(() => aiPerceptionExperiments.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => aiPrompts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.experimentId, t.promptId] })],
);

// One simulated answer and how it reads the brand. A replay that does not name
// the brand has no stance or sentiment.
export const aiPerceptionExperimentReplays = pgTable(
  "ai_perception_experiment_replays",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => aiPerceptionExperiments.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => aiPrompts.id, { onDelete: "cascade" }),
    arm: text("arm", { enum: EXPERIMENT_ARMS }).notNull(),
    repeat: integer("repeat").notNull(),
    answerMarkdown: text("answer_markdown").notNull(),
    named: boolean("named").notNull(),
    stance: text("stance", { enum: PERCEPTION_STANCES }),
    sentiment: text("sentiment", { enum: PERCEPTION_SENTIMENTS }),
    evidence: text("evidence"),
    costUsd: real("cost_usd").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("ai_perception_experiment_replays_slot_idx").on(
      t.experimentId,
      t.promptId,
      t.arm,
      t.repeat,
    ),
  ],
);
