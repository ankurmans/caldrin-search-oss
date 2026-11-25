/* eslint-disable max-lines -- the link acquisition tables share one set of enums and relations */
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import {
  LINK_CAMPAIGN_MODES,
  LINK_ACTORS,
  LINK_DISCOVERY_METHODS,
  LINK_PROSPECT_STATUSES,
  LINK_RECOMMENDATIONS,
  LINK_SIGNAL_KINDS,
} from "@/shared/link-acquisition";
import { projects } from "./app.schema";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const actor = LINK_ACTORS;

// ============================================================================
// Link gap. One paid read of the referring domains that link to competitors
// and not to the project. The run is the observation: rows are never
// rewritten, so the page can say what was read and when.
// ============================================================================

export const linkGapRuns = sqliteTable(
  "link_gap_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    targetDomain: text("target_domain").notNull(),
    // "partial" lists domains linking to at least two competitors, "all" only
    // those linking to every competitor.
    mode: text("mode", { enum: ["partial", "all"] }).notNull(),
    // Whether each competitor was also read alone, which finds domains that
    // link to only one of them.
    includeSingle: integer("include_single", { mode: "boolean" }).notNull(),
    // "live" reads links the provider still finds, "lost" those it no longer does.
    linkStatus: text("link_status", { enum: ["live", "lost"] }).notNull(),
    includeSubdomains: integer("include_subdomains", {
      mode: "boolean",
    }).notNull(),
    rowLimit: integer("row_limit").notNull(),
    // The provider's own count of matching referring domains.
    providerTotal: integer("provider_total"),
    estimatedUsd: real("estimated_usd").notNull(),
    costUsd: real("cost_usd").notNull(),
    status: text("status", {
      enum: ["complete", "partial", "failed"],
    }).notNull(),
    rowCount: integer("row_count").notNull(),
    createdBy: text("created_by", { enum: actor }).notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    index("link_gap_runs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

// The competitors compared in a run, in the order the provider keyed them.
export const linkGapRunCompetitors = sqliteTable(
  "link_gap_run_competitors",
  {
    runId: text("run_id")
      .notNull()
      .references(() => linkGapRuns.id, { onDelete: "cascade" }),
    competitorDomain: text("competitor_domain").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.competitorDomain] })],
);

// One referring domain found in a run. Counts are aggregates for the domain
// across a competitor's site; the linking page and destination come from an
// evidence read, never from here.
export const linkGapCandidates = sqliteTable(
  "link_gap_candidates",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => linkGapRuns.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    referringDomain: text("referring_domain").notNull(),
    // How many of the run's competitors this domain links to.
    competitorCount: integer("competitor_count").notNull(),
    // Highest DataForSEO Domain Rank, native 0 to 1000 scale, across competitors.
    domainRank: integer("domain_rank"),
    // Highest provider spam score across competitors, 0 to 100.
    spamScore: integer("spam_score"),
    // Earliest first_seen across competitors.
    firstSeen: text("first_seen"),
    lostDate: text("lost_date"),
    observedAt: text("observed_at").notNull(),
  },
  (table) => [
    uniqueIndex("link_gap_candidates_run_domain_idx").on(
      table.runId,
      table.referringDomain,
    ),
    index("link_gap_candidates_project_run_idx").on(
      table.projectId,
      table.runId,
    ),
  ],
);

// What the provider reported for one competitor under one candidate domain.
export const linkGapCandidateCompetitors = sqliteTable(
  "link_gap_candidate_competitors",
  {
    candidateId: text("candidate_id")
      .notNull()
      .references(() => linkGapCandidates.id, { onDelete: "cascade" }),
    competitorDomain: text("competitor_domain").notNull(),
    backlinks: integer("backlinks"),
    referringPages: integer("referring_pages"),
    nofollowPages: integer("nofollow_pages"),
    domainRank: integer("domain_rank"),
    spamScore: integer("spam_score"),
    firstSeen: text("first_seen"),
    lostDate: text("lost_date"),
    // The platform and placement types the provider counts most often.
    topPlatform: text("top_platform"),
    topPlacement: text("top_placement"),
  },
  (table) => [
    primaryKey({ columns: [table.candidateId, table.competitorDomain] }),
  ],
);

// The weights and limits behind a qualification. One row per project; absent
// means the defaults. Every score shows which of these produced it.
export const linkQualificationSettings = sqliteTable(
  "link_qualification_settings",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    minCompetitors: integer("min_competitors").notNull().default(1),
    preferredLanguage: text("preferred_language"),
    // Soft limits: a domain past them loses points, it is not excluded.
    softMaxSpamScore: integer("soft_max_spam_score").notNull().default(40),
    softMinDomainRank: integer("soft_min_domain_rank").notNull().default(100),
    weightCompetitors: integer("weight_competitors").notNull().default(30),
    weightAuthority: integer("weight_authority").notNull().default(15),
    weightContext: integer("weight_context").notNull().default(20),
    weightFollow: integer("weight_follow").notNull().default(10),
    weightPersistence: integer("weight_persistence").notNull().default(10),
    weightEffort: integer("weight_effort").notNull().default(15),
    pursueAt: integer("pursue_at").notNull().default(60),
    skipBelow: integer("skip_below").notNull().default(35),
    updatedAt: text("updated_at").notNull().default(now),
    updatedBy: text("updated_by", { enum: actor }).notNull(),
  },
);

// ============================================================================
// Evidence. One row per observed link, with the provider's own words. Fields
// the provider did not report stay null; nothing here is inferred.
// ============================================================================

export const linkEvidence = sqliteTable(
  "link_evidence",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    referringDomain: text("referring_domain").notNull(),
    // The competitor the link points at; null for a link to the project itself.
    competitorDomain: text("competitor_domain"),
    urlFrom: text("url_from").notNull(),
    urlTo: text("url_to").notNull(),
    anchor: text("anchor"),
    textBefore: text("text_before"),
    textAfter: text("text_after"),
    semanticLocation: text("semantic_location"),
    itemType: text("item_type"),
    isDofollow: integer("is_dofollow", { mode: "boolean" }),
    isNofollow: integer("is_nofollow", { mode: "boolean" }).notNull(),
    isSponsored: integer("is_sponsored", { mode: "boolean" }).notNull(),
    isUgc: integer("is_ugc", { mode: "boolean" }).notNull(),
    pageTitle: text("page_title"),
    pageLanguage: text("page_language"),
    platformType: text("platform_type"),
    domainRank: integer("domain_rank"),
    pageRank: integer("page_rank"),
    spamScore: integer("spam_score"),
    firstSeen: text("first_seen"),
    lastSeen: text("last_seen"),
    lostDate: text("lost_date"),
    targetStatusCode: integer("target_status_code"),
    targetRedirect: text("target_redirect"),
    // Where and when the record was collected.
    source: text("source", {
      enum: ["dataforseo_backlinks", "page_fetch"],
    }).notNull(),
    collectedAt: text("collected_at").notNull(),
  },
  (table) => [
    uniqueIndex("link_evidence_link_idx").on(
      table.projectId,
      table.urlFrom,
      table.urlTo,
    ),
    index("link_evidence_project_domain_idx").on(
      table.projectId,
      table.referringDomain,
    ),
  ],
);

// ============================================================================
// Prospects: the people-managed list built from candidates and other discovery
// methods. A prospect is a site, optionally pinned to one page of it.
// ============================================================================

export const linkProspects = sqliteTable(
  "link_prospects",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Stable identity: the bare host, plus "|path" for a page-specific prospect.
    dedupeKey: text("dedupe_key").notNull(),
    referringDomain: text("referring_domain").notNull(),
    pageUrl: text("page_url"),
    method: text("method", { enum: LINK_DISCOVERY_METHODS }).notNull(),
    campaignMode: text("campaign_mode", { enum: LINK_CAMPAIGN_MODES })
      .notNull()
      .default("earned_editorial"),
    status: text("status", { enum: LINK_PROSPECT_STATUSES })
      .notNull()
      .default("discovered"),
    // The qualification recorded at the time the person last saved or
    // requalified it. The live recommendation is recomputed from settings.
    recommendation: text("recommendation", { enum: LINK_RECOMMENDATIONS }),
    score: integer("score"),
    // The page on the project the link should point to, when known.
    targetUrl: text("target_url"),
    // Set when no suitable page exists and a brief was made for it.
    contentOpportunityId: text("content_opportunity_id"),
    sourceRunId: text("source_run_id").references(() => linkGapRuns.id, {
      onDelete: "set null",
    }),
    assigneeUserId: text("assignee_user_id"),
    dueDate: text("due_date"),
    notes: text("notes"),
    createdBy: text("created_by", { enum: actor }).notNull(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("link_prospects_project_key_idx").on(
      table.projectId,
      table.dedupeKey,
    ),
    index("link_prospects_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);

export const linkProspectEvents = sqliteTable(
  "link_prospect_events",
  {
    id: text("id").primaryKey(),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => linkProspects.id, { onDelete: "cascade" }),
    fromStatus: text("from_status", { enum: LINK_PROSPECT_STATUSES }),
    toStatus: text("to_status", { enum: LINK_PROSPECT_STATUSES }).notNull(),
    note: text("note"),
    actor: text("actor", { enum: actor }).notNull(),
    actorUserId: text("actor_user_id"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    index("link_prospect_events_prospect_idx").on(
      table.prospectId,
      table.createdAt,
    ),
  ],
);

// Facts a discovery method recorded about a prospect, kept apart from the
// link-gap counts: AI-answer citations, a lost link's last known state, a brand
// mention found on a fetched page. Each has the time it was observed.
export const linkProspectSignals = sqliteTable(
  "link_prospect_signals",
  {
    id: text("id").primaryKey(),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => linkProspects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LINK_SIGNAL_KINDS }).notNull(),
    value: text("value").notNull(),
    url: text("url"),
    source: text("source").notNull(),
    observedAt: text("observed_at").notNull(),
  },
  (table) => [
    index("link_prospect_signals_prospect_idx").on(
      table.prospectId,
      table.kind,
    ),
  ],
);

// ============================================================================
// Outreach. Drafts are written from a prospect's real page and linking
// evidence, edited by a person, and approved before anything is exported or
// sent. Contacts are only ever what a person entered.
// ============================================================================

export const linkOutreachDrafts = sqliteTable(
  "link_outreach_drafts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    prospectId: text("prospect_id")
      .notNull()
      .references(() => linkProspects.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    status: text("status", {
      enum: ["draft", "approved", "exported", "sent", "withdrawn"],
    })
      .notNull()
      .default("draft"),
    // Whether a person changed the generated text.
    editedByUser: integer("edited_by_user", { mode: "boolean" })
      .notNull()
      .default(false),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
    createdBy: text("created_by", { enum: actor }).notNull(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("link_outreach_drafts_prospect_idx").on(
      table.prospectId,
      table.createdAt,
    ),
  ],
);

// The evidence rows a draft is written from, so each claim can be checked.
export const linkOutreachDraftEvidence = sqliteTable(
  "link_outreach_draft_evidence",
  {
    draftId: text("draft_id")
      .notNull()
      .references(() => linkOutreachDrafts.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => linkEvidence.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.draftId, table.evidenceId] })],
);

export const linkOutreachEvents = sqliteTable(
  "link_outreach_events",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => linkOutreachDrafts.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "approved",
        "exported",
        "marked_sent",
        "reply_logged",
        "withdrawn",
      ],
    }).notNull(),
    note: text("note"),
    actor: text("actor", { enum: actor }).notNull(),
    actorUserId: text("actor_user_id"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    index("link_outreach_events_draft_idx").on(table.draftId, table.createdAt),
  ],
);

// Addresses and domains that must not be contacted again from this project.
export const linkOutreachSuppressions = sqliteTable(
  "link_outreach_suppressions",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // A lowercase email address or a bare domain.
    value: text("value").notNull(),
    reason: text("reason", {
      enum: ["unsubscribed", "declined", "bounced", "do_not_contact"],
    }).notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.value] })],
);

// ============================================================================
// Placements: links the project expects or has, and what checking the live
// page found. A backlink-count trend is not proof of a placement; only a check
// that found a real hyperlink to the intended destination confirms one.
// ============================================================================

export const linkPlacements = sqliteTable(
  "link_placements",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    prospectId: text("prospect_id").references(() => linkProspects.id, {
      onDelete: "set null",
    }),
    campaignMode: text("campaign_mode", {
      enum: LINK_CAMPAIGN_MODES,
    }).notNull(),
    urlFrom: text("url_from").notNull(),
    // The page the link is meant to point to.
    expectedTarget: text("expected_target").notNull(),
    state: text("state", {
      enum: [
        "promised",
        "observed",
        "confirmed_live",
        "later_removed",
        "no_longer_verifiable",
      ],
    })
      .notNull()
      .default("promised"),
    // Money paid or equivalent effort, when the person records it.
    costUsd: real("cost_usd"),
    firstVerifiedAt: text("first_verified_at"),
    lastVerifiedAt: text("last_verified_at"),
    lastCheckedAt: text("last_checked_at"),
    createdBy: text("created_by", { enum: actor }).notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("link_placements_project_link_idx").on(
      table.projectId,
      table.urlFrom,
      table.expectedTarget,
    ),
  ],
);

export const linkPlacementChecks = sqliteTable(
  "link_placement_checks",
  {
    id: text("id").primaryKey(),
    placementId: text("placement_id")
      .notNull()
      .references(() => linkPlacements.id, { onDelete: "cascade" }),
    outcome: text("outcome", {
      enum: [
        "confirmed",
        "link_missing",
        "destination_changed",
        "attributes_changed",
        "page_gone",
        "unverifiable",
      ],
    }).notNull(),
    httpStatus: integer("http_status"),
    finalUrl: text("final_url"),
    canonicalUrl: text("canonical_url"),
    foundHref: text("found_href"),
    anchor: text("anchor"),
    isNofollow: integer("is_nofollow", { mode: "boolean" }),
    isSponsored: integer("is_sponsored", { mode: "boolean" }),
    isUgc: integer("is_ugc", { mode: "boolean" }),
    context: text("context"),
    note: text("note"),
    checkedAt: text("checked_at").notNull().default(now),
  },
  (table) => [
    index("link_placement_checks_placement_idx").on(
      table.placementId,
      table.checkedAt,
    ),
  ],
);
