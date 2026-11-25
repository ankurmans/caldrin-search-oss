import type { CitationGapFinding } from "@/shared/citation-gaps";
import type {
  EvidenceInput,
  OpportunityCandidate,
} from "@/server/features/opportunities/types";

const MAX_PROMPT_ROWS = 10;
const MAX_SOURCE_ROWS = 10;

/**
 * A citation-gap finding as a Search Opportunity. AI answers have no search
 * clicks or impressions, so those columns stay zero and every number lives in
 * the evidence rows, with the dates the answers were collected.
 */
export function gapCandidate(
  finding: CitationGapFinding,
  now: string,
): OpportunityCandidate {
  if (!finding.action) throw new Error("A measurement note is not an action.");
  const observedAt = finding.observed.last ?? now;
  const evidence: EvidenceInput[] = [
    {
      source: "ai_visibility",
      label: "Prompt group",
      value: finding.promptGroup,
      observedAt,
    },
    {
      source: "ai_visibility",
      label: "Finding",
      value: finding.summary,
      observedAt,
    },
    {
      source: "ai_visibility",
      label: "Suggested action",
      value: finding.suggestedAction,
    },
    {
      source: "ai_visibility",
      label: "Estimated effort",
      value: `${finding.effort.level}: ${finding.effort.reason}`,
    },
    {
      source: "ai_visibility",
      label: "Collected",
      value: `${finding.observed.first ?? "unknown"} to ${finding.observed.last ?? "unknown"}, ${finding.answersInGroup} answered collections in the group`,
    },
    ...finding.factors.map((f) => ({
      source: "ai_visibility",
      label: f.label,
      value: f.value,
    })),
    ...finding.competitors.map((c) => ({
      source: "ai_visibility",
      label: "Competitor in these answers",
      value: `${c.name} (${c.domain}): ${c.answers} answer(s)`,
    })),
    ...finding.prompts.slice(0, MAX_PROMPT_ROWS).map((p) => ({
      source: "ai_visibility",
      label: "Prompt",
      value: p.prompt,
    })),
    ...finding.sources.slice(0, MAX_SOURCE_ROWS).flatMap((s) =>
      s.urls.slice(0, 3).map((url) => ({
        source: "ai_visibility",
        label: `Cited source (${s.answers} answer(s))`,
        value: s.domain,
        url,
      })),
    ),
    ...finding.uncertaintyNotes.map((note) => ({
      source: "ai_visibility",
      label: "Measurement caveat",
      value: note,
    })),
  ];
  return {
    dedupeKey: finding.key,
    // The prompt drafting would write for, or the group when it covers many.
    query: finding.prompts[0]?.prompt ?? finding.promptGroup,
    pageUrl: null,
    action: finding.action,
    reason: `${finding.title}. ${finding.suggestedAction}`,
    matchedCollectionHandle: null,
    dataSource: "ai_visibility",
    intent: null,
    priority: finding.priority,
    priorityReason: finding.priorityReason,
    observedAt,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    position: 0,
    windowStart: finding.observed.first ?? observedAt,
    windowEnd: observedAt,
    evidence,
  };
}
