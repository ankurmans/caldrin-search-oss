import { sort, unique } from "remeda";
import type { PerceptionOutcome } from "@/shared/ai-perception";
import type {
  PerceptionOpportunity,
  PerceptionOpportunityEvidence,
} from "@/shared/ai-perception-opportunities";
import type {
  PerceptionSourceRow,
  PerceptionTheme,
} from "@/shared/ai-perception-sources";
import type { AiEngine } from "@/shared/ai-visibility";

/** One answer that tracks the brand, with its reading and what rivals got. */
export interface OpportunityAnswer {
  observationId: string;
  engine: AiEngine;
  prompt: string;
  topic: string;
  outcome: PerceptionOutcome;
  evidence: string | null;
  /** Competitors the answer set against the brand and favoured over it. */
  preferred: string[];
  /** Tracked competitors the answer recommended. */
  recommendedRivals: string[];
}

export interface OpportunityInput {
  brand: string;
  answers: OpportunityAnswer[];
  themes: PerceptionTheme[];
  sources: PerceptionSourceRow[];
  contradictions: {
    fact: string;
    observationId: string;
    engine: AiEngine;
    prompt: string;
    quote: string | null;
  }[];
  /** The brand's recommended rate over all its read mentions. */
  baseline: number | null;
  /** Weaker when few runs back a figure. */
  runs: number;
}

const rate = (n: number, d: number) => ({
  numerator: n,
  denominator: d,
  rate: d ? n / d : null,
});
const MAX_EVIDENCE = 5;
const MAX_THEMES = 5;

function priorityOf(count: number): "high" | "medium" | "low" {
  return count >= 3 ? "high" : count === 2 ? "medium" : "low";
}

/** One answer is a sample; a few answers across more than one run is firmer. */
function confidenceOf(count: number, runs: number): "high" | "medium" | "low" {
  if (count >= 3 && runs >= 3) return "high";
  return count >= 2 ? "medium" : "low";
}

const evidenceOf = (
  list: OpportunityAnswer[],
  note: (a: OpportunityAnswer) => string,
): PerceptionOpportunityEvidence[] =>
  list.slice(0, MAX_EVIDENCE).map((a) => ({
    observationId: a.observationId,
    engine: a.engine,
    prompt: a.prompt,
    quote: a.evidence,
    note: note(a),
  }));

/**
 * Findings the saved readings support, each counted, with a suggested remedy
 * kept apart from the count. Nothing here is a forecast of what an engine will
 * say after a change.
 */
export function perceptionOpportunities(
  input: OpportunityInput,
): PerceptionOpportunity[] {
  const total = input.answers.length;
  const found: PerceptionOpportunity[] = [];

  const rivals = unique(input.answers.flatMap((a) => a.preferred));
  for (const rival of rivals) {
    const hits = input.answers.filter((a) => a.preferred.includes(rival));
    found.push({
      id: `competitor_preferred:${rival.toLowerCase()}`,
      kind: "competitor_preferred",
      title: `${rival} is preferred over ${input.brand} in ${hits.length} ${hits.length === 1 ? "answer" : "answers"}`,
      answers: rate(hits.length, total),
      priority: priorityOf(hits.length),
      confidence: confidenceOf(hits.length, input.runs),
      observed: `In ${hits.length} of ${total} answers that track ${input.brand}, the answer set it against ${rival} and favoured ${rival}.`,
      inferred: `A page that compares ${input.brand} with ${rival} on the points those answers raise may change which one an answer favours. This is untested.`,
      buyerQuestions: unique(hits.map((h) => h.prompt)),
      evidence: evidenceOf(hits, () => `Favours ${rival}`),
      route: "content_studio",
      effort: "medium",
      action: "create_page",
    });
  }

  const notRecommended = input.answers.filter(
    (a) => a.outcome === "neutral" || a.outcome === "negative",
  );
  for (const topic of unique(notRecommended.map((a) => a.topic))) {
    const hits = notRecommended.filter((a) => a.topic === topic);
    found.push({
      id: `named_not_recommended:${topic.toLowerCase()}`,
      kind: "named_not_recommended",
      title: `Named but not recommended for “${topic}”`,
      answers: rate(hits.length, total),
      priority: hits.some((h) => h.outcome === "negative")
        ? "high"
        : priorityOf(hits.length),
      confidence: confidenceOf(hits.length, input.runs),
      observed: `${hits.length} answers on this topic name ${input.brand} without recommending it${hits.some((h) => h.outcome === "negative") ? ", and some describe it negatively" : ""}.`,
      inferred: `Content that answers these buyer questions directly, with proof for the claims, may give answers something to recommend. This is untested.`,
      buyerQuestions: unique(hits.map((h) => h.prompt)),
      evidence: evidenceOf(hits, (h) =>
        h.outcome === "negative" ? "Described negatively" : "Named neutrally",
      ),
      route: "content_studio",
      effort: "medium",
      action: "refresh_existing_page",
    });
  }

  const absent = input.answers.filter(
    (a) => a.outcome === "missing" && a.recommendedRivals.length,
  );
  for (const topic of unique(absent.map((a) => a.topic))) {
    const hits = absent.filter((a) => a.topic === topic);
    const names = unique(hits.flatMap((h) => h.recommendedRivals));
    found.push({
      id: `absent_competitor_recommended:${topic.toLowerCase()}`,
      kind: "absent_competitor_recommended",
      title: `Not named for “${topic}” while ${names.join(", ")} ${names.length === 1 ? "is" : "are"} recommended`,
      answers: rate(hits.length, total),
      priority: priorityOf(hits.length),
      confidence: confidenceOf(hits.length, input.runs),
      observed: `${hits.length} answers on this topic never name ${input.brand} and recommend ${names.join(", ")}.`,
      inferred: `${input.brand} may lack a page that answers these questions. Check what the sources those answers cite say before writing one.`,
      buyerQuestions: unique(hits.map((h) => h.prompt)),
      evidence: evidenceOf(
        hits,
        (h) => `Recommends ${h.recommendedRivals.join(", ")}`,
      ),
      route: "content_studio",
      effort: "high",
      action: "new_article",
    });
  }

  for (const theme of input.themes
    .filter((t) => t.kind !== "strength")
    .slice(0, MAX_THEMES)) {
    found.push({
      id: `recurring_objection:${theme.id}`,
      kind: "recurring_objection",
      title: `Answers raise: ${theme.label}`,
      answers: theme.answers,
      priority: priorityOf(theme.answers.numerator),
      confidence: confidenceOf(theme.answers.numerator, input.runs),
      observed: `${theme.answers.numerator} of ${theme.answers.denominator} read mentions of ${input.brand} give this ${theme.kind === "objection" ? "reason to hesitate" : "flaw"}, on ${theme.prompts} ${theme.prompts === 1 ? "prompt" : "prompts"}.`,
      inferred: `If the point is wrong or out of date, saying so plainly on a page an answer can cite may remove it. If it is true, it is a product or positioning matter for a person to decide.`,
      buyerQuestions: [],
      evidence: theme.examples.map((x) => ({
        observationId: x.observationId,
        engine: x.engine,
        prompt: "",
        quote: x.quote,
        note: x.text,
      })),
      route: "human_decision",
      effort: "medium",
      action: "review_brand_information",
    });
  }

  for (const source of input.sources) {
    const read =
      source.outcomes.recommended +
      source.outcomes.neutral +
      source.outcomes.negative;
    const not = source.outcomes.neutral + source.outcomes.negative;
    const third =
      source.sourceClass !== "own" && source.sourceClass !== "competitor";
    if (
      !third ||
      not < 2 ||
      input.baseline === null ||
      source.outcomes.recommended / read >= input.baseline
    )
      continue;
    found.push({
      id: `unfavourable_source:${source.domain}`,
      kind: "unfavourable_source",
      title: `${source.domain} appears beside answers that do not recommend ${input.brand}`,
      answers: rate(not, read),
      priority: "low",
      confidence: "low",
      observed: `Of ${read} read answers citing ${source.domain}, ${not} named ${input.brand} without recommending it, against ${Math.round((input.baseline ?? 0) * 100)}% recommended across all sources.`,
      inferred: `Being covered or corrected on that site may help, but the answers citing it are not shown to be caused by it.`,
      buyerQuestions: [],
      evidence: source.pages.map((p) => ({
        observationId: "",
        engine: source.engines[0],
        prompt: "",
        quote: null,
        note: p.url,
      })),
      route: "link_acquisition",
      effort: "high",
      action: "earn_third_party_coverage",
    });
  }

  const facts = unique(input.contradictions.map((c) => c.fact));
  for (const fact of facts) {
    const hits = input.contradictions.filter((c) => c.fact === fact);
    found.push({
      id: `contradicted_fact:${fact.toLowerCase().slice(0, 80)}`,
      kind: "contradicted_fact",
      title: `Answers contradict a fact you set: ${fact}`,
      answers: rate(hits.length, total),
      priority: "high",
      confidence: confidenceOf(hits.length, input.runs),
      observed: `${hits.length} answers state something a small model read as contradicting “${fact}”. A reading is a lead to confirm, not a ruling.`,
      inferred: `Confirm in the answer, then publish the correct statement where the cited sources can pick it up.`,
      buyerQuestions: unique(hits.map((h) => h.prompt)),
      evidence: hits.slice(0, MAX_EVIDENCE).map((h) => ({
        observationId: h.observationId,
        engine: h.engine,
        prompt: h.prompt,
        quote: h.quote,
        note: "Contradicts the saved fact",
      })),
      route: "human_decision",
      effort: "low",
      action: "review_brand_information",
    });
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  return sort(
    found,
    (a, b) =>
      order[a.priority] - order[b.priority] ||
      b.answers.numerator - a.answers.numerator ||
      a.title.localeCompare(b.title),
  );
}
