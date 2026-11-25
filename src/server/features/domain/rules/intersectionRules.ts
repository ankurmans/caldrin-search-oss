/**
 * Pairing Google organic results with AI answers for the same query. Pure: the
 * service gathers stored evidence, these rules decide what may be compared and
 * what the pairing says. Nothing here estimates; missing data stays missing.
 */

export type AiEngine =
  | "chatgpt"
  | "gemini"
  | "google_ai_overview"
  | "google_ai_mode"
  | "claude"
  | "perplexity";

/** Provider-indexed data is refreshed about monthly; tracked runs are weekly. */
const PROVIDER_WINDOW_DAYS = 31;
const TRACKED_WINDOW_DAYS = 7;

/** The provider's ChatGPT index holds US English only. */
const CHATGPT_INDEX_LOCATION = 2840;

export type OrganicEvidence = {
  source: "provider_keywords" | "serp_read" | "rank_tracker";
  /** Null means not found within `depth` results, never "does not rank". */
  position: number | null;
  /** Results read; null when the source does not say how deep it looked. */
  depth: number | null;
  url: string | null;
  checkedAt: string | null;
  locationCode: number;
};

export type AiAnswerEvidence = {
  engine: AiEngine;
  source: "provider_mentions" | "tracked_answers";
  /** The answer names the domain or brand. */
  named: boolean;
  /** A cited source belongs to the domain. */
  cited: boolean;
  /** Null when the source does not report recommendations. */
  recommended: boolean | null;
  citedUrls: string[];
  /** Cited pages on other domains, for comparing what the engine chose. */
  competingUrls: string[];
  observedAt: string | null;
  locationCode: number;
};

type Comparison =
  | { comparable: true; daysApart: number }
  | { comparable: false; reason: string; daysApart: number | null };

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[?!.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const first = Date.parse(a);
  const second = Date.parse(b);
  if (Number.isNaN(first) || Number.isNaN(second)) return null;
  return Math.round(Math.abs(first - second) / 86_400_000);
}

/** Whether one AI answer may sit beside one organic reading. */
export function compareEvidence(
  organic: OrganicEvidence,
  ai: AiAnswerEvidence,
): Comparison {
  if (ai.engine === "chatgpt" && ai.source === "provider_mentions") {
    if (organic.locationCode !== CHATGPT_INDEX_LOCATION) {
      return {
        comparable: false,
        reason: "ChatGPT data is US English only, the organic market is not",
        daysApart: null,
      };
    }
  } else if (organic.locationCode !== ai.locationCode) {
    return {
      comparable: false,
      reason: "Collected for different markets",
      daysApart: null,
    };
  }
  const daysApart = daysBetween(organic.checkedAt, ai.observedAt);
  if (daysApart === null) {
    return {
      comparable: false,
      reason: "A collection date is missing",
      daysApart: null,
    };
  }
  const window =
    organic.source === "provider_keywords" || ai.source === "provider_mentions"
      ? PROVIDER_WINDOW_DAYS
      : TRACKED_WINDOW_DAYS;
  if (daysApart > window) {
    return {
      comparable: false,
      reason: `Collected ${daysApart} days apart, over the ${window}-day limit`,
      daysApart,
    };
  }
  return { comparable: true, daysApart };
}

type OrganicState = "ranked" | "outside_depth" | "no_capture";
type AiState = "cited" | "named_only" | "absent" | "no_answers";

export function organicState(organic: OrganicEvidence | null): OrganicState {
  if (!organic) return "no_capture";
  if (organic.position !== null) return "ranked";
  // A source that never says how deep it looked cannot show absence.
  return organic.depth !== null ? "outside_depth" : "no_capture";
}

/** Cited beats named, and named is not a citation. */
export function aiState(answers: AiAnswerEvidence[]): AiState {
  if (answers.length === 0) return "no_answers";
  if (answers.some((a) => a.cited)) return "cited";
  if (answers.some((a) => a.named)) return "named_only";
  return "absent";
}

type Gap =
  | "ranks_not_cited"
  | "missing_from_both"
  | "cited_without_ranking"
  | null;

/**
 * A gap only exists where both sides were read and may be compared. Missing
 * from both needs engines to have cited other domains: an answer that cited
 * nobody gives nothing to compare against.
 */
export function gapFor(
  organic: OrganicState,
  ai: AiState,
  competingCitations: boolean,
): Gap {
  if (organic === "ranked" && (ai === "named_only" || ai === "absent")) {
    return "ranks_not_cited";
  }
  if (organic === "outside_depth" && ai === "cited") {
    return "cited_without_ranking";
  }
  if (
    organic === "outside_depth" &&
    (ai === "named_only" || ai === "absent") &&
    competingCitations
  ) {
    return "missing_from_both";
  }
  return null;
}

type OpportunityIntent =
  | "informational"
  | "commercial"
  | "transactional"
  | "navigational";

type OpportunityPlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      action: "refresh_existing_page" | "new_article" | "create_page";
      pageUrl: string | null;
      reason: string;
      priority: "high" | "medium" | "low";
    };

/**
 * What a gap supports doing. Volume never decides this: a page that already
 * ranks supports a refresh, and a new page needs a buyer intent a person set
 * on the prompt.
 */
export function planOpportunity(input: {
  gap: Gap;
  organicUrl: string | null;
  position: number | null;
  intent: OpportunityIntent | null;
}): OpportunityPlan {
  if (input.gap === "ranks_not_cited") {
    if (!input.organicUrl) {
      return { ok: false, reason: "No ranking page was recorded to improve." };
    }
    return {
      ok: true,
      action: "refresh_existing_page",
      pageUrl: input.organicUrl,
      reason: `The page ranks at ${input.position} but the AI answers do not cite it.`,
      priority:
        input.position !== null && input.position <= 10 ? "high" : "medium",
    };
  }
  if (input.gap === "missing_from_both") {
    if (!input.intent) {
      return {
        ok: false,
        reason:
          "Set a buyer intent on this prompt first. Without one there is no basis to recommend a page.",
      };
    }
    if (input.intent === "navigational") {
      return { ok: false, reason: "A navigational query needs no new page." };
    }
    return {
      ok: true,
      action: input.intent === "informational" ? "new_article" : "create_page",
      pageUrl: null,
      reason:
        "The domain is outside the organic results read and the AI answers cite other domains instead.",
      priority: input.intent === "informational" ? "low" : "medium",
    };
  }
  if (input.gap === "cited_without_ranking") {
    return {
      ok: false,
      reason:
        "Already cited by AI answers without ranking. Worth watching, not a page to build.",
    };
  }
  return { ok: false, reason: "No organic and AI gap for this query." };
}
