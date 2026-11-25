import type { ParsedPage, SnapshotView } from "@/shared/source-gap";
import {
  isCandidateRead,
  type EvidenceQuality,
  type GapOutcome,
  type OwnerCandidate,
  type OwnerConfidence,
  type RetrievalState,
} from "@/shared/source-gap-owner";
import { PLAUSIBLE_OWNER_SCORE } from "./ownerPageSelector";
import {
  isComparativePrompt,
  THIN_PAGE_WORDS,
  uncoveredTopicWords,
} from "./pageSignals";

const STRONG_PAGE_WORDS = 300;
/** An unread page this close to the pick, by its first-guess score, could still beat it once read. */
const UNREAD_THREAT = 0.75;
const MAX_MISSING = 4;
const SERVER_ERROR = 500;
const TIMEOUT_OR_BUSY = [408, 429];

interface Retrieval {
  state: RetrievalState;
  note: string | null;
  /** True when reading the page again could work. */
  retryable: boolean;
}

/** What the attempt to read a page came to, kept apart from what the page says. */
export function retrievalOf(snapshot: SnapshotView | null): Retrieval {
  if (!snapshot)
    return {
      state: "NOT_ATTEMPTED",
      note: "Not read in this analysis.",
      retryable: true,
    };
  const note = snapshot.note;
  const http = snapshot.httpStatus ?? 0;
  switch (snapshot.status) {
    case "ok":
      if (!snapshot.page)
        return {
          state: "FETCH_FAILED",
          note: "The page was fetched but its text could not be read.",
          retryable: true,
        };
      return {
        state:
          snapshot.page.wordCount < THIN_PAGE_WORDS
            ? "FETCHED_INSUFFICIENT_CONTENT"
            : "FETCHED_AND_CLASSIFIED",
        note,
        retryable: false,
      };
    case "blocked_by_robots":
    case "challenge":
      return { state: "BLOCKED", note, retryable: false };
    case "unreachable":
      return /redirect/i.test(note ?? "")
        ? { state: "REDIRECT_ERROR", note, retryable: false }
        : { state: "FETCH_FAILED", note, retryable: true };
    case "http_error":
      return {
        state: "FETCH_FAILED",
        note,
        retryable: http >= SERVER_ERROR || TIMEOUT_OR_BUSY.includes(http),
      };
    case "homepage_only":
    case "skipped":
      return { state: "NOT_ATTEMPTED", note, retryable: false };
    default:
      return { state: "FETCH_FAILED", note, retryable: false };
  }
}

export function evidenceQualityOf(page: ParsedPage | null): EvidenceQuality {
  if (!page) return "none";
  if (page.wordCount < THIN_PAGE_WORDS) return "thin";
  return page.wordCount >= STRONG_PAGE_WORDS &&
    page.h2s.length + page.h3s.length >= 3
    ? "strong"
    : "partial";
}

/** What a page would need to show to answer the prompt better, or what could not be judged. */
export function missingEvidenceOf(
  candidate: OwnerCandidate,
  page: ParsedPage | null,
  prompt: string,
  intent: string | null,
): string[] {
  if (!page)
    return [
      "The page was not read, so nothing about its content could be judged.",
    ];
  const out: string[] = [];
  if (candidate.retrieval === "FETCHED_INSUFFICIENT_CONTENT")
    out.push(
      "Very little text was read; the page may need JavaScript to show its content.",
    );
  const absent = uncoveredTopicWords(
    prompt,
    `${page.title ?? ""} ${page.h1s.join(" ")} ${page.h2s.join(" ")} ${page.h3s.join(" ")} ${page.text}`,
  );
  if (absent.length)
    out.push(`Never mentions: ${absent.slice(0, 4).join(", ")}.`);
  if (candidate.typeFit !== undefined) {
    if (candidate.pageType === "unknown")
      out.push("Could not tell what the page is for.");
    else if (candidate.typeFit < 0.6)
      out.push(
        `Reads as ${candidate.pageType?.replace("_", "-")}, not what the prompt asks for.`,
      );
  }
  if (
    isComparativePrompt(prompt, intent) &&
    candidate.pageType !== "comparison" &&
    (candidate.optionsCompared ?? 0) < 3
  )
    out.push("Does not set several products side by side.");
  if (
    candidate.pageType !== "comparison" &&
    candidate.pageType !== "pricing" &&
    candidate.typeFit !== undefined &&
    !page.commercial.price
  )
    out.push("States no price.");
  return out.slice(0, MAX_MISSING);
}

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
const TYPE_WORDS = {
  how_to: "a how-to guide",
  comparison: "a comparison",
  pricing: "a pricing page",
  product: "a single-product page",
  unknown: "a page of unclear purpose",
} as const;

function against(a: OwnerCandidate, b: OwnerCandidate, verb: string): string {
  const here = verb === "above" ? "it" : "this page";
  const parts = [
    `relevance ${a.score.toFixed(2)} against ${b.score.toFixed(2)}`,
  ];
  if (a.pageType && b.pageType && a.pageType !== b.pageType)
    parts.push(
      `${here} reads as ${TYPE_WORDS[a.pageType]}, the other as ${TYPE_WORDS[b.pageType]}`,
    );
  if (a.confidence && b.confidence && a.confidence !== b.confidence)
    parts.push(`${a.confidence} confidence against ${b.confidence}`);
  return `Ranks ${verb} ${pathOf(b.url)}: ${parts.join("; ")}.`;
}

/** Why each read page sits where it does among its neighbours. Pages that were not read are not ranked against read ones. */
export function rankingReasons(candidates: OwnerCandidate[]): void {
  const read = candidates.filter(isCandidateRead);
  for (const [i, c] of candidates.entries()) {
    if (!isCandidateRead(c)) {
      c.ranking = [
        "Not compared with the pages that were read, because it was not read.",
      ];
      continue;
    }
    const at = read.indexOf(c);
    const next = read[at + 1];
    const prev = read[at - 1];
    c.ranking = [
      ...(next ? [against(c, next, "above")] : []),
      ...(prev && i > 0 ? [against(c, prev, "below")] : []),
    ];
    if (!c.ranking.length) c.ranking = ["The only page that was read."];
  }
}

/**
 * What the existing pages say about the prompt. A new page is only called for
 * when every plausible page was read and none speaks to the prompt, and the
 * site's page list was complete.
 */
export function gapOutcomeOf(input: {
  selected: OwnerCandidate | null;
  confidence: OwnerConfidence | null;
  overridden: boolean;
  candidates: OwnerCandidate[];
  listComplete: boolean;
}): GapOutcome {
  const { selected, confidence, candidates } = input;
  const unread = candidates.filter((c) => !isCandidateRead(c));
  if (selected) {
    if (input.overridden) return "EXISTING_OWNER_CONFIRMED";
    if (confidence === "low") return "OWNER_UNCERTAIN";
    // A page that failed to be read and looks at least as close could be the
    // real owner, so the pick is not settled.
    if (
      unread.some(
        (c) => c.retrieval !== "NOT_ATTEMPTED" && c.score >= selected.score,
      )
    )
      return "OWNER_UNCERTAIN";
    const rivals = unread.some(
      (c) => c.score >= selected.score * UNREAD_THREAT,
    );
    return confidence === "high" && !rivals
      ? "EXISTING_OWNER_CONFIRMED"
      : "EXISTING_OWNER_PROBABLE";
  }
  const plausible = candidates.some((c) => c.score >= PLAUSIBLE_OWNER_SCORE);
  return plausible || !input.listComplete
    ? "OWNER_UNCERTAIN"
    : "CONTENT_GAP_CONFIRMED";
}
