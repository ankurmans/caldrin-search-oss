import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { aiObservations } from "./ai-visibility.schema";
import {
  PERCEPTION_COMPARISON_OUTCOMES,
  PERCEPTION_CONFIDENCES,
  PERCEPTION_POINT_KINDS,
  PERCEPTION_SENTIMENTS,
  PERCEPTION_STANCES,
} from "@/shared/ai-perception";

// How one saved answer treats one brand it names, read by a model. One row per
// answer, brand and classifier version, so a new classifier adds a reading
// beside the old one instead of overwriting it. Only answers with text that
// names the brand are read: a citation alone or a missing answer has no row.
export const aiPerceptions = pgTable(
  "ai_perceptions",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiObservations.id, { onDelete: "cascade" }),
    // Name and domain as matched when the answer was collected.
    domain: text("domain").notNull(),
    name: text("name").notNull(),
    own: boolean("own").notNull(),
    stance: text("stance", { enum: PERCEPTION_STANCES }).notNull(),
    sentiment: text("sentiment", { enum: PERCEPTION_SENTIMENTS }).notNull(),
    confidence: text("confidence", { enum: PERCEPTION_CONFIDENCES }).notNull(),
    // Words copied from the answer that the reading rests on; null when the
    // model's quote was not found in the text.
    evidence: text("evidence"),
    // True when the brand was matched only by a word that can mean something
    // else (a domain stem), so the reading may be about another thing.
    ambiguousName: boolean("ambiguous_name").notNull(),
    classifierVersion: text("classifier_version").notNull(),
    model: text("model").notNull(),
    classifiedAt: text("classified_at").notNull(),
    // A person's correction, kept beside the model's reading. Null until
    // someone reviews it; the history is in ai_perception_reviews.
    reviewedStance: text("reviewed_stance", { enum: PERCEPTION_STANCES }),
    reviewedSentiment: text("reviewed_sentiment", {
      enum: PERCEPTION_SENTIMENTS,
    }),
  },
  (t) => [
    uniqueIndex("ai_perceptions_obs_domain_version_idx").on(
      t.observationId,
      t.domain,
      t.classifierVersion,
    ),
    index("ai_perceptions_observation_idx").on(t.observationId),
  ],
);

// Strengths, weaknesses and buyer objections an answer states about a brand.
export const aiPerceptionPoints = pgTable(
  "ai_perception_points",
  {
    id: text("id").primaryKey(),
    perceptionId: text("perception_id")
      .notNull()
      .references(() => aiPerceptions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: PERCEPTION_POINT_KINDS }).notNull(),
    text: text("text").notNull(),
    // Words from the answer that state the point. A point without a quote
    // found in the answer is not saved.
    quote: text("quote").notNull(),
  },
  (t) => [index("ai_perception_points_perception_idx").on(t.perceptionId)],
);

// How the answer ranks the brand against a competitor it also names.
export const aiPerceptionComparisons = pgTable(
  "ai_perception_comparisons",
  {
    id: text("id").primaryKey(),
    perceptionId: text("perception_id")
      .notNull()
      .references(() => aiPerceptions.id, { onDelete: "cascade" }),
    competitorDomain: text("competitor_domain").notNull(),
    competitorName: text("competitor_name").notNull(),
    outcome: text("outcome", {
      enum: PERCEPTION_COMPARISON_OUTCOMES,
    }).notNull(),
  },
  (t) => [
    uniqueIndex("ai_perception_comparisons_perception_competitor_idx").on(
      t.perceptionId,
      t.competitorDomain,
    ),
  ],
);

// Every correction a person made to a reading, oldest first.
export const aiPerceptionReviews = pgTable(
  "ai_perception_reviews",
  {
    id: text("id").primaryKey(),
    perceptionId: text("perception_id")
      .notNull()
      .references(() => aiPerceptions.id, { onDelete: "cascade" }),
    field: text("field", { enum: ["stance", "sentiment"] }).notNull(),
    // The value before and after the correction. The first correction starts
    // from the model's reading.
    fromValue: text("from_value").notNull(),
    toValue: text("to_value").notNull(),
    note: text("note"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at").notNull(),
  },
  (t) => [index("ai_perception_reviews_perception_idx").on(t.perceptionId)],
);
