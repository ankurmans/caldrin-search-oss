import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { AI_PROMPT_INTENTS } from "@/shared/ai-prompt-intent";

// One tracker per project. Brand name, domain and competitors come from the
// project and its competitors when each answer is matched.
export const aiTrackers = pgTable(
  "ai_trackers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    chatgpt: boolean("chatgpt").notNull().default(true),
    gemini: boolean("gemini").notNull().default(false),
    claude: boolean("claude").notNull().default(false),
    perplexity: boolean("perplexity").notNull().default(false),
    googleAiOverview: boolean("google_ai_overview").notNull().default(false),
    googleAiMode: boolean("google_ai_mode").notNull().default(false),
    locationCode: integer("location_code").notNull().default(2840),
    languageCode: text("language_code").notNull().default("en"),
    scheduleInterval: text("schedule_interval", {
      enum: ["daily", "weekly", "monthly"],
    })
      .notNull()
      .default("weekly"),
    nextCheckAt: text("next_check_at"),
    lastSkipReason: text("last_skip_reason"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("ai_trackers_project_idx").on(t.projectId),
    index("ai_trackers_due_idx").on(t.enabled, t.nextCheckAt),
  ],
);

// Countries a tracker checks besides its own market (locationCode and
// languageCode on the tracker). One prompt set is collected in every market.
export const aiTrackerMarkets = pgTable(
  "ai_tracker_markets",
  {
    trackerId: text("tracker_id")
      .notNull()
      .references(() => aiTrackers.id, { onDelete: "cascade" }),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.trackerId, t.locationCode, t.languageCode],
    }),
  ],
);

// Prompt text never changes: an edit archives the prompt and adds a new one,
// so stored answers always belong to the exact text they were collected for.
export const aiPrompts = pgTable(
  "ai_prompts",
  {
    id: text("id").primaryKey(),
    trackerId: text("tracker_id")
      .notNull()
      .references(() => aiTrackers.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    text: text("text").notNull(),
    paused: boolean("paused").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    // Buyer intent set by a person; null means unknown and is never guessed.
    intent: text("intent", { enum: AI_PROMPT_INTENTS }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ai_prompts_tracker_idx").on(t.trackerId)],
);

// What the provider reports for how often people ask an AI this exact prompt
// wording, per market. A null volume means the provider reported none for it,
// which is not the same as zero.
export const aiPromptVolumes = pgTable(
  "ai_prompt_volumes",
  {
    promptId: text("prompt_id")
      .notNull()
      .references(() => aiPrompts.id, { onDelete: "cascade" }),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    volume: integer("volume"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.promptId, t.locationCode, t.languageCode],
    }),
  ],
);

// A partial unique index allows one queued or running check per tracker and
// market, like rank_check_runs. A failed INSERT is the "already running" signal.
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: text("id").primaryKey(),
    trackerId: text("tracker_id")
      .notNull()
      .references(() => aiTrackers.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    trigger: text("trigger", {
      enum: ["baseline", "scheduled", "manual"],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "partial", "failed"],
    })
      .notNull()
      .default("queued"),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    // The prompt set this run measured; null for runs before versioning.
    promptSetVersionId: text("prompt_set_version_id"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("ai_runs_project_created_idx").on(t.projectId, t.createdAt),
    uniqueIndex("ai_runs_one_active_idx")
      .on(t.trackerId, t.locationCode, t.languageCode)
      .where(sql`${t.status} IN ('queued', 'running')`),
  ],
);

// One answer per prompt and engine in a run. Rows are created pending when the
// run starts, so the run's size is its row count.
export const aiObservations = pgTable(
  "ai_observations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => aiPrompts.id, { onDelete: "cascade" }),
    engine: text("engine", {
      enum: [
        "chatgpt",
        "gemini",
        "google_ai_overview",
        "google_ai_mode",
        "claude",
        "perplexity",
      ],
    }).notNull(),
    // Whether the prompt names the project's own brand when the run started.
    branded: boolean("branded").notNull(),
    status: text("status", { enum: ["pending", "completed", "failed"] })
      .notNull()
      .default("pending"),
    collectedAt: text("collected_at"),
    // The model or surface version the provider reports, when it reports one.
    model: text("model"),
    // Whether the provider's result carried a fan-out query list, and a list of
    // retrieved pages, for this answer. Null on rows saved before these fields
    // were read: they are unknown, never "none".
    queriesExposed: boolean("queries_exposed"),
    retrievalExposed: boolean("retrieval_exposed"),
    // Null on a completed row means the engine gave no answer.
    answerMarkdown: text("answer_markdown"),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("ai_observations_run_prompt_engine_idx").on(
      t.runId,
      t.promptId,
      t.engine,
    ),
    index("ai_observations_prompt_idx").on(t.promptId),
  ],
);

// Pages an answer cites, in the engine's order.
export const aiSources = pgTable(
  "ai_sources",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiObservations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    position: integer("position").notNull(),
    // "provider_source" when the provider listed the page as a source,
    // "answer_link" when it is only linked in the answer text. Null on rows
    // saved before origins were kept.
    origin: text("origin", { enum: ["provider_source", "answer_link"] }),
  },
  (t) => [index("ai_sources_observation_idx").on(t.observationId)],
);

// Searches the provider reported the engine ran for an answer (fan-outs), in
// the order reported. Only what the provider exposes: an engine that hides its
// searches has no rows and a null or false `queriesExposed`.
export const aiObservationQueries = pgTable(
  "ai_observation_queries",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiObservations.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("ai_observation_queries_observation_idx").on(t.observationId)],
);

// Pages the provider reported the engine retrieved while answering, whether or
// not the answer cites them. Cited pages are in ai_sources.
export const aiObservationRetrievals = pgTable(
  "ai_observation_retrievals",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiObservations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    description: text("description"),
    position: integer("position").notNull(),
  },
  (t) => [
    index("ai_observation_retrievals_observation_idx").on(t.observationId),
  ],
);

// Products an answer showed, as the provider's products element lists them, in
// its order. Only fields the provider reports: it gives no merchant, URL,
// rating or product id for a ChatGPT product card. An answer with no card has
// no rows, which says nothing about engines that never return one.
export const aiObservationProducts = pgTable(
  "ai_observation_products",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiObservations.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    price: real("price"),
    currency: text("currency"),
    // A label the engine put on the card, such as "Best overall".
    tag: text("tag"),
    providerField: text("provider_field").notNull(),
  },
  (t) => [index("ai_observation_products_observation_idx").on(t.observationId)],
);

// A person's decision about a source domain in Source Intelligence: watch it
// for new appearances, or dismiss it from the findings. One per project and
// domain; the latest decision replaces the last.
export const aiSourceDecisions = pgTable(
  "ai_source_decisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    decision: text("decision", { enum: ["monitor", "dismiss"] }).notNull(),
    decidedAt: text("decided_at").notNull(),
    decidedBy: text("decided_by"),
  },
  (t) => [
    uniqueIndex("ai_source_decisions_project_domain_idx").on(
      t.projectId,
      t.domain,
    ),
  ],
);

// What one external source page says, read on request. One per project and
// URL; reading it again replaces the last reading. Mentions of the brand and
// tracked competitors are found by matching the page text, not by the model.
export const sourcePageAnalyses = pgTable(
  "source_page_analyses",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    summary: text("summary").notNull(),
    pageKind: text("page_kind", {
      enum: [
        "vendor_page",
        "comparison",
        "independent_review",
        "guide",
        "other",
      ],
    }).notNull(),
    namesBrand: boolean("names_brand").notNull(),
    model: text("model"),
    costUsd: real("cost_usd").notNull(),
    analysedAt: text("analysed_at").notNull(),
  },
  (t) => [
    uniqueIndex("source_page_analyses_project_url_idx").on(t.projectId, t.url),
  ],
);

export const sourcePageAnalysisItems = pgTable(
  "source_page_analysis_items",
  {
    id: text("id").primaryKey(),
    analysisId: text("analysis_id")
      .notNull()
      .references(() => sourcePageAnalyses.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["buyer_question", "competitor_named", "dated_fact"],
    }).notNull(),
    text: text("text").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("source_page_analysis_items_analysis_idx").on(t.analysisId)],
);

// Each brand's result in one answer. Name and domain are copied from the
// project when the answer is matched, so later edits never rewrite history.
export const aiMatches = pgTable(
  "ai_matches",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiObservations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    own: boolean("own").notNull(),
    mentioned: boolean("mentioned").notNull(),
    cited: boolean("cited").notNull(),
    // Whether the answer recommends this brand; null until detected.
    recommended: boolean("recommended"),
    // Character offset of the first mention in the answer's plain text.
    firstMention: integer("first_mention"),
    // Phase 2 sentiment of the answer text about this brand. Null until a
    // classifier with recorded model and evaluation runs; never estimated.
    sentiment: text("sentiment", {
      enum: ["positive", "neutral", "negative", "mixed"],
    }),
    sentimentModel: text("sentiment_model"),
    sentimentClassifiedAt: text("sentiment_classified_at"),
    // The extractor that produced mentioned/cited/recommended. Null on rows
    // written before extraction was versioned; they are never reclassified.
    extractionVersion: text("extraction_version"),
  },
  (t) => [
    uniqueIndex("ai_matches_observation_domain_idx").on(
      t.observationId,
      t.domain,
    ),
  ],
);

// A prompt set is the exact list of prompts a run measures. A new version is
// created whenever the active prompts change, so a rate is only compared with
// rates from the same version.
export const aiPromptSetVersions = pgTable(
  "ai_prompt_set_versions",
  {
    id: text("id").primaryKey(),
    trackerId: text("tracker_id")
      .notNull()
      .references(() => aiTrackers.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("ai_prompt_set_versions_tracker_version_idx").on(
      t.trackerId,
      t.version,
    ),
  ],
);

export const aiPromptSetMembers = pgTable(
  "ai_prompt_set_members",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => aiPromptSetVersions.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => aiPrompts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.promptId] })],
);
