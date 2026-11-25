import {
  type ConsensusPattern,
  type EvidenceLevel,
  type ParsedPage,
  type RootCause,
  type RootCauseCategory,
} from "@/shared/source-gap";
import {
  isCandidateRead,
  OWNER_PAGE_TYPE_LABELS,
  RETRIEVAL_LABELS,
  type OwnerCandidate,
} from "@/shared/source-gap-owner";
import {
  buildConsensus,
  isRecurring,
  missingEntities,
  readableCompetitors,
} from "./sourceGapDifferences";
import {
  confidenceFrom,
  countText,
  pattern,
  share,
  type Diagnosis,
  type DiagnosisInput,
} from "./diagnosisShared";
import { buildRecommendations } from "./sourceGapRecommendations";
import {
  ageDays,
  intentAlignment,
  isComparativePrompt,
  isCommercialPrompt,
  pageDate,
} from "./pageSignals";
import { isThirdParty } from "./sourceClassification";
import { promptWants } from "./ownerPageType";
import { PLAUSIBLE_OWNER_SCORE } from "./ownerPageSelector";

const YEAR_DAYS = 365;

function cause(
  category: RootCauseCategory,
  evidence: string,
  level: EvidenceLevel,
  supportingUrls: string[],
  sample: { readable: number; runs: number },
): RootCause {
  return {
    category,
    evidence,
    level,
    supportingUrls,
    confidence: confidenceFrom(
      supportingUrls.length,
      sample.readable,
      sample.runs,
    ),
  };
}

function ownerFacts(page: ParsedPage | null): string {
  return page ? "" : " There is no owner page to compare.";
}

const MAX_LISTED_OWNERS = 3;

const whereAt = (c: OwnerCandidate) => `${c.url} (${c.score.toFixed(2)})`;

/**
 * Why there is no owner page to compare. "No page on the site" is only said
 * when every plausible page was read and none comes close; a page that could
 * not be read, a plausible page, or a site list that may be short is asked
 * about instead, so a failed fetch is never taken for a missing page.
 */
function ownerCause(
  input: DiagnosisInput,
  sample: { readable: number; runs: number },
): RootCause {
  const { selection } = input;
  const chosen = selection.selected;
  if (chosen)
    return cause(
      "owner_unconfirmed",
      `${selection.overridden ? "The page you chose" : "The page Caldrin picked"} (${chosen.url}) could not be read, so no page comparison was made.`,
      "observed",
      [chosen.url],
      sample,
    );
  const notes = selection.notes.join(" ");
  if (selection.outcome === "CONTENT_GAP_CONFIRMED")
    return cause(
      "no_owner_page",
      `None of the ${selection.pagesChecked ?? "listed"} pages checked from the sitemap, crawl, Search Console and the site's own links speaks to this prompt, and every plausible page was read. ${notes}`.trim(),
      "observed",
      [],
      sample,
    );
  const plausible = selection.candidates.filter(
    (c) => c.score >= PLAUSIBLE_OWNER_SCORE,
  );
  const close = plausible.filter(isCandidateRead).slice(0, MAX_LISTED_OWNERS);
  const unread = plausible
    .filter((c) => !isCandidateRead(c))
    .slice(0, MAX_LISTED_OWNERS);
  const parts = [
    "No page on your site is confirmed as the page for this prompt.",
    close.length
      ? `${close.length === 1 ? "One existing page is" : "Existing pages are"} close: ${close.map(whereAt).join(", ")}.`
      : "",
    unread.length
      ? `${unread.length === 1 ? "One plausible page" : "Plausible pages"} could not be read and ${unread.length === 1 ? "was" : "were"} not assessed: ${unread.map((c) => `${c.url} (${RETRIEVAL_LABELS[c.retrieval ?? "NOT_ATTEMPTED"].toLowerCase()})`).join(", ")}.`
      : "",
    selection.listComplete === false
      ? "The list of the site's pages may be incomplete, so a page for it may exist."
      : "",
    "Check before creating a page, or choose the owner yourself.",
    notes,
  ];
  return cause(
    "owner_unconfirmed",
    parts.filter(Boolean).join(" "),
    "observed",
    [...close, ...unread].map((c) => c.url),
    sample,
  );
}

const WANTED_PAGE = {
  buy: "a comparison or pricing page",
  how_to: "a how-to guide",
} as const;

/**
 * The closest page that was read, when it covers the topic but is the wrong
 * kind for what the prompt asks. Such a page is worth improving or replacing
 * as the owner, so it is named instead of a new page being proposed.
 */
function wrongKindOwner(
  input: DiagnosisInput,
): { candidate: OwnerCandidate; wanted: string } | null {
  const wants = promptWants(input.prompt, input.intent);
  if (!wants) return null;
  const { selection } = input;
  const candidate =
    selection.selected ??
    selection.candidates.find(
      (c) => isCandidateRead(c) && c.score >= PLAUSIBLE_OWNER_SCORE,
    );
  if (
    !candidate ||
    !isCandidateRead(candidate) ||
    candidate.typeFit === undefined ||
    candidate.typeFit >= 0.6
  )
    return null;
  return { candidate, wanted: WANTED_PAGE[wants] };
}

/** Root causes in the order they should be read: the most supported first. */
function findRootCauses(
  input: DiagnosisInput,
  consensus: ConsensusPattern[],
): RootCause[] {
  const readable = readableCompetitors(input.sources);
  const n = readable.length;
  const runs = input.runCount;
  const out: RootCause[] = [];
  const third = input.sources.filter(
    (s) => isThirdParty(s.sourceType) && s.sourceType !== "platform",
  );
  const thirdReadable = third.filter((s) => s.snapshot?.status === "ok");

  if (!input.owner) out.push(ownerCause(input, { readable: n, runs }));
  const wrong = wrongKindOwner(input);
  if (wrong)
    out.push(
      cause(
        "owner_page_type_mismatch",
        `${wrong.candidate.url} is the closest page and covers the topic, but it reads as ${OWNER_PAGE_TYPE_LABELS[wrong.candidate.pageType ?? "unknown"].toLowerCase()}, and the prompt asks for ${wrong.wanted}. Improve this page before creating a new one.`,
        "observed",
        [wrong.candidate.url],
        { readable: n, runs },
      ),
    );

  if (input.owner && n > 0) {
    const intent = pattern(consensus, "intent_in_heading");
    const mine = intentAlignment(input.prompt, input.owner);
    if (intent && isRecurring(intent) && mine.score < 0.5)
      out.push(
        cause(
          "retrieval_intent_mismatch",
          `${countText(intent)} put the prompt's topic words in the title or H1; your owner page's title and H1 cover ${Math.round(mine.score * 100)}% of them ("${mine.heading || "no title"}").`,
          "inferred",
          intent.urls,
          { readable: n, runs },
        ),
      );

    if (isCommercialPrompt(input.prompt, input.intent)) {
      const missing = ["explicit_price", "billing_model"]
        .map((k) => pattern(consensus, k))
        .filter(
          (p): p is ConsensusPattern =>
            !!p && isRecurring(p) && p.yours === false,
        );
      if (missing.length) {
        const top = missing.reduce((a, b) =>
          b.citedCount > a.citedCount ? b : a,
        );
        out.push(
          cause(
            "missing_facts",
            `${missing.map((p) => `${countText(p)} ${p.label}`).join("; ")}. Your owner page does not.`,
            "observed",
            top.urls,
            { readable: n, runs },
          ),
        );
      }
    }

    if (isComparativePrompt(input.prompt, input.intent)) {
      const structure = pattern(consensus, "comparison_structure");
      const choose = pattern(consensus, "which_to_choose");
      const lacking = [structure, choose].filter(
        (p): p is ConsensusPattern =>
          !!p && isRecurring(p) && p.yours === false,
      );
      if (lacking.length)
        out.push(
          cause(
            "weak_comparison_structure",
            `The prompt asks the reader to choose. ${lacking.map((p) => `${countText(p)} ${p.label}`).join("; ")}. Your owner page does not.`,
            "observed",
            lacking[0].urls,
            { readable: n, runs },
          ),
        );
    }

    const entities = missingEntities(input);
    if (entities.length)
      out.push(
        cause(
          "weak_entity_coverage",
          `Names that most cited pages mention and your owner page does not: ${entities.map((e) => `${e.entity} (${e.count} of ${e.readable})`).join(", ")}.`,
          "inferred",
          entities[0].urls,
          { readable: n, runs },
        ),
      );

    const firstHand = pattern(consensus, "first_hand");
    if (firstHand && isRecurring(firstHand) && firstHand.yours === false)
      out.push(
        cause(
          "weak_information_gain",
          `${countText(firstHand)} show signs of testing, such as a stated method, benchmarks or sample output. Your owner page shows none.`,
          "inferred",
          firstHand.urls,
          { readable: n, runs },
        ),
      );

    const recent = pattern(consensus, "recent_date");
    const mineAge = ageDays(pageDate(input.owner), input.now);
    if (
      recent &&
      isRecurring(recent) &&
      (mineAge === null || mineAge > YEAR_DAYS)
    )
      out.push(
        cause(
          "freshness_gap",
          `${countText(recent)} show a date within the last 12 months. ${mineAge === null ? "Your owner page shows no date." : `Your owner page shows a date ${mineAge} days ago.`}`,
          "observed",
          recent.urls,
          { readable: n, runs },
        ),
      );
  }

  const namingCompetitors = thirdReadable.filter(
    (s) => s.brandsOnPage.length > 0,
  );
  const namingYou = thirdReadable.filter((s) => s.ownOnPage);
  if (
    namingCompetitors.length >= 2 &&
    share(namingYou.length, thirdReadable.length) <= 0.25
  )
    out.push(
      cause(
        "weak_third_party_corroboration",
        `${namingCompetitors.length} of ${thirdReadable.length} cited third-party pages name tracked competitors; ${namingYou.length} name you.`,
        "observed",
        namingCompetitors.map((s) => s.url),
        { readable: thirdReadable.length, runs },
      ),
    );

  const onPage = out.filter((c) =>
    [
      "no_owner_page",
      "owner_unconfirmed",
      "owner_page_type_mismatch",
      "retrieval_intent_mismatch",
      "missing_facts",
      "weak_comparison_structure",
      "weak_entity_coverage",
      "weak_information_gain",
      "freshness_gap",
    ].includes(c.category),
  );
  if (input.owner && n > 0 && onPage.length === 0)
    out.push({
      category: "no_clear_content_gap",
      evidence: `Your owner page matches the patterns that recur across ${n} readable cited pages.${out.length ? " The remaining difference is outside the page." : ""} The difference may be authority, which is not measured here, or ordinary variation in what engines retrieve.`,
      level: "hypothesis",
      supportingUrls: [],
      confidence: "low",
    });
  if (n === 0 && input.sources.length === 0)
    out.push({
      category: "no_clear_content_gap",
      evidence: `No pages were cited in the stored answers for this prompt, so there is nothing to compare.${ownerFacts(input.owner)}`,
      level: "observed",
      supportingUrls: [],
      confidence: "low",
    });
  return out;
}

export function diagnose(input: DiagnosisInput): Diagnosis {
  const consensus = buildConsensus(input);
  const rootCauses = findRootCauses(input, consensus);
  const recommendations = buildRecommendations(input, consensus, rootCauses);
  const notes: string[] = [];
  const readable = readableCompetitors(input.sources).length;
  const unread = input.sources.filter(
    (s) => s.sourceType !== "own" && s.snapshot?.status !== "ok",
  ).length;
  if (input.runCount < 2)
    notes.push(
      "This rests on one collection run. The pages engines cite change between runs, so treat the patterns as observations from one sample.",
    );
  if (unread > 0)
    notes.push(
      `${unread} cited page(s) could not be read and are left out of the patterns; the reason is shown on each.`,
    );
  if (readable > 0 && readable < 3)
    notes.push(
      `Only ${readable} cited page(s) were readable, too few to call anything a pattern with confidence.`,
    );
  notes.push(
    "Backlinks and authority are not measured in this analysis, so a gap there would not appear above.",
  );
  notes.push(
    "These are differences seen in cited pages. They do not show why an engine chose them, and changing a page does not guarantee a different answer.",
  );
  if (input.owner)
    notes.push(
      `Facts are compared against ${input.selection.overridden ? "the page you chose" : "the page Caldrin picked"}, read on the date shown on its snapshot.`,
    );
  return { consensus, rootCauses, recommendations, notes };
}
