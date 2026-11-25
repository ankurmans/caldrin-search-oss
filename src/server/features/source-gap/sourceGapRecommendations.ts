import type {
  Confidence,
  ConsensusPattern,
  EvidenceLevel,
  Recommendation,
  RecommendationAction,
  RootCause,
  RootCauseCategory,
} from "@/shared/source-gap";
import {
  confidenceFrom,
  countText,
  pattern,
  share,
  type DiagnosisInput,
} from "./diagnosisShared";
import {
  isRecurring,
  missingEntities,
  readableCompetitors,
} from "./sourceGapDifferences";
import { isBuyerIntent } from "./pageSignals";

const EFFORT: Record<RecommendationAction, Confidence> = {
  improve_existing_owner: "low",
  add_pricing_fact: "low",
  add_comparison_table: "medium",
  add_best_for_section: "low",
  add_competitor_entities: "medium",
  add_first_hand_test: "high",
  add_original_benchmark: "high",
  strengthen_attribution: "low",
  update_stale_content: "low",
  add_structured_table: "medium",
  improve_internal_links: "low",
  pursue_independent_mentions: "high",
  pursue_links_from_cited_ecosystem: "high",
  create_owner_page: "high",
  choose_owner_page: "low",
  no_change_measure_more: "low",
};

type Draft = {
  action: RecommendationAction;
  rootCause: RootCauseCategory;
  reason: string;
  effect: string;
  level: EvidenceLevel;
  support: ConsensusPattern | null;
  urls: string[];
  dependency?: "third_party";
};

function prioritize(input: {
  citedCount: number;
  readable: number;
  buyer: boolean;
  ownerExists: boolean;
  thirdParty: boolean;
  createsOwner: boolean;
}): { priority: "high" | "medium" | "low"; reason: string } {
  const s = share(input.citedCount, input.readable);
  const parts = [
    `seen on ${input.citedCount} of ${input.readable} cited pages`,
    input.buyer ? "buyer-intent prompt" : "prompt intent not clearly buyer",
    input.ownerExists || input.createsOwner
      ? input.ownerExists
        ? "an owner page exists"
        : "needs a new page"
      : "no owner page",
    input.thirdParty ? "depends on other sites" : "within your own site",
  ];
  let priority: "high" | "medium" | "low" = "low";
  if (input.citedCount >= 2 && s >= 0.4) priority = "medium";
  if (
    input.citedCount >= 3 &&
    s >= 0.6 &&
    input.buyer &&
    !input.thirdParty &&
    (input.ownerExists || input.createsOwner)
  )
    priority = "high";
  return { priority, reason: parts.join("; ") };
}

function drafts(
  input: DiagnosisInput,
  consensus: ConsensusPattern[],
  causes: RootCause[],
): Draft[] {
  const out: Draft[] = [];
  const has = (c: RootCauseCategory) => causes.find((x) => x.category === c);
  const p = (k: string) => pattern(consensus, k)!;
  const n = readableCompetitors(input.sources).length;

  if (has("no_owner_page"))
    out.push({
      action: "create_owner_page",
      rootCause: "no_owner_page",
      reason: `No page on your site scored as the page for "${input.prompt}", while ${input.sources.filter((s) => s.sourceType !== "own").length} other pages were cited.`,
      effect:
        "A page that speaks to this prompt would give engines something of yours to retrieve for it. Test by re-running the prompt after publishing.",
      level: "hypothesis",
      support: null,
      urls: has("no_owner_page")!.supportingUrls,
    });
  if (has("owner_unconfirmed"))
    out.push({
      action: "choose_owner_page",
      rootCause: "owner_unconfirmed",
      reason: has("owner_unconfirmed")!.evidence,
      effect:
        "Confirming the page that already answers this prompt lets the next analysis compare it with the cited pages. Create a new page only if none of the existing ones fits.",
      level: "observed",
      support: null,
      urls: has("owner_unconfirmed")!.supportingUrls,
    });
  if (has("owner_page_type_mismatch"))
    out.push({
      action: "improve_existing_owner",
      rootCause: "owner_page_type_mismatch",
      reason: has("owner_page_type_mismatch")!.evidence,
      effect:
        "An existing page already covers the topic. Giving it the content the prompt asks for is cheaper than a new page and keeps its history; worth testing.",
      level: "observed",
      support: null,
      // The evidence is the owner page itself, named in the reason.
      urls: [],
    });
  if (has("retrieval_intent_mismatch"))
    out.push({
      action: "improve_existing_owner",
      rootCause: "retrieval_intent_mismatch",
      reason: has("retrieval_intent_mismatch")!.evidence,
      effect:
        "Plausible retrieval gap worth testing: a title and H1 that name what the prompt asks.",
      level: "hypothesis",
      support: p("intent_in_heading"),
      urls: p("intent_in_heading").urls,
    });
  if (has("missing_facts")) {
    const price = p("explicit_price");
    const model = p("billing_model");
    const missing = [price, model].filter(
      (x) => isRecurring(x) && x.yours === false,
    );
    const strongest = missing.reduce((a, b) =>
      b.citedCount > a.citedCount ? b : a,
    );
    out.push({
      action: "add_pricing_fact",
      rootCause: "missing_facts",
      reason: `${missing.map((x) => `${countText(x)} ${x.label}`).join("; ")}. Your owner page does not. Add the missing fact in one short section.`,
      effect:
        "Cited pages consistently expose these facts; adding them is a plausible retrieval gap worth testing.",
      level: "hypothesis",
      support: strongest,
      urls: strongest.urls,
    });
    const table = p("structured_table");
    if (isRecurring(table) && table.yours === false)
      out.push({
        action: "add_structured_table",
        rootCause: "missing_facts",
        reason: `${countText(table)} ${table.label}; your owner page has no such table.`,
        effect:
          "Facts in a table are easy to read out; worth testing against this prompt.",
        level: "hypothesis",
        support: table,
        urls: table.urls,
      });
  }
  if (has("weak_comparison_structure")) {
    const structure = p("comparison_structure");
    const choose = p("which_to_choose");
    if (isRecurring(structure) && structure.yours === false)
      out.push({
        action: "add_comparison_table",
        rootCause: "weak_comparison_structure",
        reason: `${countText(structure)} ${structure.label}; your owner page does not.`,
        effect:
          "A page that compares options directly answers the choice the prompt asks for; worth testing.",
        level: "hypothesis",
        support: structure,
        urls: structure.urls,
      });
    if (isRecurring(choose) && choose.yours === false)
      out.push({
        action: "add_best_for_section",
        rootCause: "weak_comparison_structure",
        reason: `${countText(choose)} ${choose.label}; your owner page does not.`,
        effect: "A best-for line says who each option suits; worth testing.",
        level: "hypothesis",
        support: choose,
        urls: choose.urls,
      });
  }
  if (has("weak_entity_coverage")) {
    const entities = missingEntities(input);
    out.push({
      action: "add_competitor_entities",
      rootCause: "weak_entity_coverage",
      reason: has("weak_entity_coverage")!.evidence,
      effect:
        "Naming the products and platforms buyers compare may match how cited pages are written. Add only the ones that are true for your product.",
      level: "hypothesis",
      support: null,
      urls: entities[0]?.urls ?? [],
    });
  }
  if (has("weak_information_gain")) {
    const fh = p("first_hand");
    out.push({
      action: "add_first_hand_test",
      rootCause: "weak_information_gain",
      reason: has("weak_information_gain")!.evidence,
      effect:
        "Original test results give a page something others lack; worth testing.",
      level: "hypothesis",
      support: fh,
      urls: fh.urls,
    });
    const author = p("named_author");
    if (isRecurring(author) && author.yours === false)
      out.push({
        action: "strengthen_attribution",
        rootCause: "weak_information_gain",
        reason: `${countText(author)} ${author.label}; your owner page does not.`,
        effect:
          "A named author or reviewer is a visible trust signal; the effect on retrieval is untested.",
        level: "hypothesis",
        support: author,
        urls: author.urls,
      });
  }
  if (has("freshness_gap")) {
    const recent = p("recent_date");
    out.push({
      action: "update_stale_content",
      rootCause: "freshness_gap",
      reason: has("freshness_gap")!.evidence,
      effect:
        "A visible updated date, after the page is really reviewed, may help; worth testing.",
      level: "hypothesis",
      support: recent,
      urls: recent.urls,
    });
  }
  if (has("weak_third_party_corroboration")) {
    const c = has("weak_third_party_corroboration")!;
    out.push({
      action: "pursue_independent_mentions",
      rootCause: "weak_third_party_corroboration",
      reason: c.evidence,
      effect:
        "Independent pages that name you would put you in the sources engines already cite; the effect is untested.",
      level: "hypothesis",
      support: null,
      urls: c.supportingUrls,
      dependency: "third_party",
    });
  }
  if (has("no_clear_content_gap") && input.owner && n > 0)
    out.push({
      action: "no_change_measure_more",
      rootCause: "no_clear_content_gap",
      reason: has("no_clear_content_gap")!.evidence,
      effect:
        "Collect more runs before changing the page, and check whether the answer set moves.",
      level: "inferred",
      support: null,
      urls: [],
    });
  return out;
}

export function buildRecommendations(
  input: DiagnosisInput,
  consensus: ConsensusPattern[],
  causes: RootCause[],
): Recommendation[] {
  const readable = readableCompetitors(input.sources).length;
  const buyer = isBuyerIntent(input.intent, input.prompt);
  return drafts(input, consensus, causes).map((d) => {
    const citedCount = d.support?.citedCount ?? d.urls.length;
    const thirdParty = d.dependency === "third_party";
    const ranked = prioritize({
      citedCount,
      readable: d.support?.readable ?? Math.max(readable, citedCount),
      buyer,
      ownerExists: !!input.owner,
      thirdParty,
      createsOwner: d.action === "create_owner_page",
    });
    return {
      action: d.action,
      reason: d.reason,
      expectedEffect: d.effect,
      effort: EFFORT[d.action],
      dependency: thirdParty ? "third_party" : "none",
      confidence: confidenceFrom(citedCount, readable, input.runCount),
      priority: d.action === "no_change_measure_more" ? "low" : ranked.priority,
      priorityReason: ranked.reason,
      level: d.level,
      rootCause: d.rootCause,
      supportingUrls: d.urls.slice(0, 8),
    };
  });
}
