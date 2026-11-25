import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { aiObservations } from "./ai-visibility.schema";

// A statement the customer says is true about their brand, such as a price or
// an opening date. Answers are checked against it; it is never sent anywhere
// else.
export const aiBrandFacts = sqliteTable(
  "ai_brand_facts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ai_brand_facts_project_idx").on(t.projectId)],
);

// What a model found when it read one saved answer against one fact. A reading
// by a model, with its name recorded, not a ruling that the answer is wrong.
export const aiFactChecks = sqliteTable(
  "ai_fact_checks",
  {
    id: text("id").primaryKey(),
    factId: text("fact_id")
      .notNull()
      .references(() => aiBrandFacts.id, { onDelete: "cascade" }),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiObservations.id, { onDelete: "cascade" }),
    verdict: text("verdict", {
      enum: ["supported", "contradicted", "not_addressed"],
    }).notNull(),
    // The words in the answer the verdict rests on; empty when not addressed.
    quote: text("quote"),
    model: text("model").notNull(),
    checkedAt: text("checked_at").notNull(),
  },
  (t) => [
    uniqueIndex("ai_fact_checks_fact_obs_idx").on(t.factId, t.observationId),
    index("ai_fact_checks_obs_idx").on(t.observationId),
  ],
);
