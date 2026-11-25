import type { OpportunityAction } from "@/server/features/content/rules/opportunityRules";
import type {
  EvidenceInput,
  OpportunityCandidate,
  OpportunityPriority,
} from "@/server/features/opportunities/types";
import { likelyPageType } from "@/server/features/site-explorer/rules/pageType";
import type { SourceAppearance } from "../repositories/SourceIntelligenceRepository";
import {
  APPROACH_LABELS,
  type Approach,
} from "@/types/schemas/source-intelligence";
import type { PageKind } from "./sourcePageRules";
import type { SourceRow } from "./sourceRules";

/** The stored reading of the page, when one was made. */
type PageReadingEvidence = {
  analysedAt: string;
  pageKind: PageKind;
  approach: Approach;
  summary: string;
  namesBrand: boolean;
  competitors: string[];
  questions: string[];
  datedFacts: string[];
};

export type SourceActionKind = "content" | "third_party" | "link_prospect";

const MAX_PROMPTS = 8;
const MAX_QUERIES = 8;

export class SourceActionRefusal extends Error {}

function priorityOf(row: SourceRow): {
  priority: OpportunityPriority;
  reason: string;
} {
  if (row.citedAnswers >= 3)
    return {
      priority: "high",
      reason: `Cited in ${row.citedAnswers} answers in the selected window.`,
    };
  if (row.citedAnswers >= 1)
    return {
      priority: "medium",
      reason: `Cited in ${row.citedAnswers} answer(s) in the selected window.`,
    };
  return {
    priority: "low",
    reason:
      "Listed as retrieved but not cited in these answers. Retrieval alone is weaker evidence than a citation.",
  };
}

/**
 * A source page as a Search Opportunity. AI answers have no clicks or
 * impressions, so those stay zero and the numbers live in the evidence rows,
 * each with the dates the answers were collected. Retrieved and cited counts
 * are kept apart, and nothing here promises a future AI citation.
 */
export function sourceCandidate(input: {
  row: SourceRow;
  appearances: SourceAppearance[];
  action: SourceActionKind;
  now: string;
  reading?: PageReadingEvidence | null;
}): OpportunityCandidate {
  const { row, appearances, action, now, reading } = input;
  if (appearances.length === 0)
    throw new SourceActionRefusal(
      "This page is not in the answers for these filters any more. Reload and try again.",
    );
  if (row.brand === "own")
    throw new SourceActionRefusal(
      "This page is on your own site. Improve it from Citation gaps or the page's own opportunities instead.",
    );
  const pageType = likelyPageType(row.key);
  // A source that is itself a product, collection, service or pricing page is no reason
  // to recommend a blog post.
  const commercial =
    pageType === "product" ||
    pageType === "collection" ||
    pageType === "service" ||
    pageType === "pricing";
  const recommended: OpportunityAction =
    action === "content"
      ? commercial
        ? "create_page"
        : "new_article"
      : "earn_third_party_coverage";
  const { priority, reason: priorityReason } = priorityOf(row);
  const dates = appearances
    .map((a) => a.collectedAt)
    .filter((d): d is string => !!d);
  dates.sort();
  const first = dates[0] ?? null;
  const last = dates.at(-1) ?? now;
  const prompts = [...new Set(appearances.map((a) => a.prompt))];
  const queries = [...new Set(appearances.flatMap((a) => a.queries))];
  const label =
    action === "content"
      ? "Content gap"
      : action === "link_prospect"
        ? "Link prospect"
        : "Third-party coverage";
  const evidence: EvidenceInput[] = [
    {
      source: "ai_visibility",
      label: "Source page",
      value: row.title ? `${row.title} (${row.domain})` : row.domain,
      url: row.key,
      observedAt: last,
    },
    {
      source: "ai_visibility",
      label: "Opportunity type",
      value:
        action === "link_prospect"
          ? "Link prospect: ask the owner of this page to cover or link to the brand."
          : label,
    },
    {
      source: "ai_visibility",
      label: "Cited in",
      value: `${row.citedAnswers} answer(s)`,
      observedAt: last,
    },
    {
      source: "ai_visibility",
      label: "Retrieved in",
      value:
        row.retrievedAnswers > 0
          ? `${row.retrievedAnswers} answer(s), as reported by the provider`
          : "No retrieval record for this page",
      observedAt: last,
    },
    {
      source: "ai_visibility",
      label: "Collected",
      value: `${first ?? "unknown"} to ${last}, on ${row.engines.join(", ")}`,
    },
    ...(row.brand === "competitor"
      ? [
          {
            source: "ai_visibility",
            label: "Competitor page",
            value: `${row.domain} is a tracked competitor.`,
          },
        ]
      : []),
    ...prompts.slice(0, MAX_PROMPTS).map((prompt) => ({
      source: "ai_visibility",
      label: "Prompt",
      value: prompt,
    })),
    ...queries.slice(0, MAX_QUERIES).map((query) => ({
      source: "ai_visibility",
      label: "Search the provider reported",
      value: query,
    })),
    ...(reading
      ? [
          {
            source: "ai_visibility",
            label: "What the page covers",
            value: `${reading.summary} (read ${reading.analysedAt.slice(0, 10)})`,
            url: row.key,
            observedAt: reading.analysedAt,
          },
          {
            source: "ai_visibility",
            label: "Suggested approach",
            value: `${APPROACH_LABELS[reading.approach]}. ${reading.namesBrand ? "The page names your brand." : "The page does not name your brand."} Competitors named: ${reading.competitors.join(", ") || "none"}.`,
          },
          ...reading.questions.slice(0, MAX_PROMPTS).map((value) => ({
            source: "ai_visibility",
            label: "Buyer question the page answers",
            value,
          })),
          ...reading.datedFacts.slice(0, MAX_QUERIES).map((value) => ({
            source: "ai_visibility",
            label: "Dated fact to check",
            value,
          })),
        ]
      : []),
    {
      source: "ai_visibility",
      label: "Measurement caveat",
      value:
        "Being named on this page does not guarantee a future AI citation. Searches and retrieved pages are only what the provider reports.",
    },
  ];
  return {
    dedupeKey: `ai_source::${action}::${row.key}`,
    query: prompts[0] ?? row.domain,
    pageUrl: null,
    action: recommended,
    reason: `${label}: ${row.title ?? row.domain} appears in AI answers for the tracked prompts. ${priorityReason}`,
    matchedCollectionHandle: null,
    dataSource: "ai_visibility",
    intent: null,
    priority,
    priorityReason,
    observedAt: last,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    position: 0,
    windowStart: first ?? last,
    windowEnd: last,
    evidence,
  };
}
