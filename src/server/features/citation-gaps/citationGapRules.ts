import { sort, unique } from "remeda";
import type {
  CitationGapFinding,
  CitationGapType,
  GapAction,
} from "@/shared/citation-gaps";
import {
  AI_PROMPT_INTENT_LABELS,
  type AiPromptIntent,
} from "@/shared/ai-prompt-intent";
import {
  groupInto,
  isAnswered,
  type IntelFact,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";
import {
  sourceKind,
  sourcesByAnswer,
  type CitedSource,
} from "./citationSourceRules";

const MAX_ANSWER_IDS = 20;
/** A third-party domain repeated in at least this many answers is its own finding. */
const REPEATED_SOURCE_ANSWERS = 2;
/** Below these, a finding is flagged as uncertain and never ranked high. */
const MIN_RUNS = 2;
const MIN_ANSWERS = 3;
const COMPARISON_WORDING =
  /\b(vs\.?|versus|compare[ds]?|comparison|alternatives?|better than)\b/i;
const COMPARISON_INTENTS = new Set(["comparison", "alternatives"]);

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

type Group = {
  topic: string;
  answered: IntelFact[];
  planned: IntelFact[];
  sources: Map<string, CitedSource[]>;
  tracked: { domain: string; name: string; own: boolean }[];
  totalPrompts: number;
};

const ownOf = (f: IntelFact) => f.brands.find((b) => b.own);
const named = (f: IntelFact) => !!ownOf(f)?.mentioned;
const ownCited = (f: IntelFact) => !!ownOf(f)?.cited;
/** An answer naming or citing a competitor while neither naming nor citing you. */
const absent = (f: IntelFact) =>
  !named(f) &&
  !ownCited(f) &&
  f.brands.some((b) => !b.own && (b.mentioned || b.cited));

function competitorsIn(answers: IntelFact[]) {
  const hits = answers.flatMap((f) =>
    f.brands.filter((b) => !b.own && (b.mentioned || b.cited)),
  );
  return sort(
    [...groupInto(hits, (b) => b.domain)].map(([domain, list]) => ({
      domain,
      name: list[0].name || domain,
      answers: list.length,
    })),
    (a, b) => b.answers - a.answers || a.name.localeCompare(b.name),
  );
}

function intentSummary(answers: IntelFact[]) {
  const prompts = [
    ...new Map(answers.map((f) => [f.promptId, f.intent])).values(),
  ];
  const counts = [
    ...groupInto(prompts, (i): AiPromptIntent | "unknown" => i ?? "unknown"),
  ].map(
    ([intent, list]) =>
      `${list.length} ${intent === "unknown" ? "unknown" : AI_PROMPT_INTENT_LABELS[intent].toLowerCase()}`,
  );
  return counts.join(", ");
}

function uncertainty(group: Group) {
  const notes: string[] = [];
  const runs = new Set(group.answered.map((f) => f.runId)).size;
  if (runs < MIN_RUNS)
    notes.push(
      `Measured in ${runs} run; one run is one sample, so repeat it before acting on small differences.`,
    );
  if (group.answered.length < MIN_ANSWERS)
    notes.push(
      `Only ${group.answered.length} answered collection(s) in this prompt group.`,
    );
  const missing = group.planned.length - group.answered.length;
  if (missing > 0)
    notes.push(
      `${missing} of ${group.planned.length} planned collections failed or returned no answer and are not counted.`,
    );
  return notes;
}

/** Explicit tiers from the group's own counts; uncertain findings stop at medium. */
function prioritize(
  absentCount: number,
  ownNamedCount: number,
  total: number,
  uncertain: boolean,
) {
  const absentShare = pct(absentCount, total);
  const ownShare = pct(ownNamedCount, total);
  let priority: CitationGapFinding["priority"] =
    absentShare >= 50 && ownShare <= 20
      ? "high"
      : absentShare >= 25
        ? "medium"
        : "low";
  let reason = `Competitors appear without you in ${absentCount} of ${total} answers (${absentShare}%); you are named in ${ownNamedCount} (${ownShare}%). High needs 50% or more without you and you in 20% or fewer; medium needs 25% or more.`;
  if (uncertain && priority === "high") {
    priority = "medium";
    reason += " Lowered to medium because the sample is small.";
  }
  return { priority, reason };
}

function finding(
  group: Group,
  type: CitationGapType,
  parts: {
    keySuffix?: string;
    title: string;
    summary: string;
    suggestedAction: string;
    action: GapAction | null;
    effort: CitationGapFinding["effort"];
    answers: IntelFact[];
    sources?: CitationGapFinding["sources"];
    extraFactors?: CitationGapFinding["factors"];
  },
): CitationGapFinding {
  const { answered } = group;
  const notes = uncertainty(group);
  const absentCount = answered.filter(absent).length;
  const ownNamedCount = answered.filter(named).length;
  const { priority, reason } = prioritize(
    absentCount,
    ownNamedCount,
    answered.length,
    notes.length > 0,
  );
  const newest = sort(parts.answers, (a, b) =>
    (b.collectedAt ?? "").localeCompare(a.collectedAt ?? ""),
  );
  const dates = sort(
    answered.flatMap((f) => f.collectedAt ?? []),
    (a, b) => a.localeCompare(b),
  );
  const promptCount = new Set(answered.map((f) => f.promptId)).size;
  return {
    key: ["ai_gap", type, group.topic, parts.keySuffix]
      .filter(Boolean)
      .join("::"),
    type,
    promptGroup: group.topic,
    title: parts.title,
    summary: parts.summary,
    suggestedAction: parts.suggestedAction,
    action: parts.action,
    prompts: [
      ...new Map(
        parts.answers.map((f) => [
          f.promptId,
          { promptId: f.promptId, prompt: f.prompt, intent: f.intent },
        ]),
      ).values(),
    ],
    competitors: competitorsIn(parts.answers),
    sources: parts.sources ?? [],
    observed: { first: dates[0] ?? null, last: dates.at(-1) ?? null },
    answerIds: newest.slice(0, MAX_ANSWER_IDS).map((f) => f.id),
    answersInGroup: answered.length,
    factors: [
      {
        label: "Prompt group",
        value: `${promptCount} of ${group.totalPrompts} tracked prompts`,
      },
      { label: "Buyer intent", value: intentSummary(answered) },
      {
        label: "Competitors without you",
        value: `${absentCount} of ${answered.length} answers`,
      },
      {
        label: "Your coverage",
        value: `named in ${ownNamedCount}, your site cited in ${answered.filter(ownCited).length} of ${answered.length}`,
      },
      ...(parts.extraFactors ?? []),
      {
        label: "Effort",
        value: `${parts.effort.level}: ${parts.effort.reason}`,
      },
    ],
    priority,
    priorityReason: reason,
    effort: parts.effort,
    uncertain: notes.length > 0,
    uncertaintyNotes: notes,
    opportunityId: null,
  };
}

function contentGap(group: Group): CitationGapFinding | null {
  const { answered, sources, tracked } = group;
  if (answered.some(ownCited)) return null;
  const rivalCited = answered.filter((f) =>
    (sources.get(f.id) ?? []).some(
      (s) => sourceKind(s.domain, tracked).kind === "competitor",
    ),
  );
  if (!rivalCited.length || !answered.some(absent)) return null;
  const rivalSources = rivalCited.flatMap((f) =>
    (sources.get(f.id) ?? []).filter(
      (s) => sourceKind(s.domain, tracked).kind === "competitor",
    ),
  );
  return finding(group, "missing_commercial_content", {
    title: `Competitor pages are cited for "${group.topic}"; yours are not`,
    summary: `In ${rivalCited.length} of ${answered.length} answers the engine cited a competitor's own site. None of the answers in this group cited your site.`,
    suggestedAction:
      "Publish or improve a page on your site that answers these questions directly.",
    action: "new_article",
    effort: { level: "medium", reason: "one page of new or reworked content" },
    answers: rivalCited,
    sources: domainList(rivalSources),
  });
}

function comparisonGap(group: Group): CitationGapFinding | null {
  const matches = group.answered.filter((f) =>
    f.intent
      ? COMPARISON_INTENTS.has(f.intent)
      : COMPARISON_WORDING.test(f.prompt),
  );
  const missing = matches.filter(absent);
  if (!missing.length) return null;
  const byWording = missing.some((f) => !f.intent);
  return finding(group, "missing_comparison_coverage", {
    title: `Comparison answers in "${group.topic}" name competitors, not you`,
    summary: `${missing.length} of ${matches.length} comparison or alternatives answers name or cite a competitor without naming you.${byWording ? " Some prompts were treated as comparisons from their wording because no intent is set." : ""}`,
    suggestedAction:
      "Publish a fair comparison or alternatives page that covers you and the named competitors.",
    action: "create_page",
    effort: {
      level: "medium",
      reason: "one comparison page, with facts you can stand behind",
    },
    answers: missing,
  });
}

function domainList(list: CitedSource[]) {
  return sort(
    [...groupInto(list, (s) => s.domain)].map(([domain, hits]) => ({
      domain,
      urls: unique(hits.map((h) => h.url)).slice(0, 10),
      answers: new Set(hits.map((h) => h.observationId)).size,
    })),
    (a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain),
  );
}

function thirdPartyFindings(group: Group): CitationGapFinding[] {
  const { answered, sources, tracked } = group;
  const missing = answered.filter(absent);
  const thirdParty = missing.flatMap((f) =>
    (sources.get(f.id) ?? []).filter(
      (s) => sourceKind(s.domain, tracked).kind === "third_party",
    ),
  );
  if (!thirdParty.length) return [];
  const domains = domainList(thirdParty);
  const repeated = domains.filter((d) => d.answers >= REPEATED_SOURCE_ANSWERS);
  const out = repeated.map((d) => {
    const citing = answered.filter((f) =>
      (sources.get(f.id) ?? []).some((s) => s.domain === d.domain),
    );
    return finding(group, "third_party_publisher", {
      keySuffix: d.domain,
      title: `${d.domain} is cited repeatedly in "${group.topic}" answers that leave you out`,
      summary: `${d.domain} is cited in ${citing.length} answers in this group, ${d.answers} of them naming a competitor without you. Being covered there may help; it does not guarantee a citation.`,
      suggestedAction: `Check whether ${d.domain} covers your category and whether you can be included, corrected or listed there.`,
      action: "earn_third_party_coverage",
      effort: {
        level: "high",
        reason: "outreach or contribution to a site you do not control",
      },
      answers: citing,
      sources: [d],
      extraFactors: [
        {
          label: "Source repeats",
          value: `cited in ${citing.length} answers across ${new Set(citing.map((f) => f.promptId)).size} prompts`,
        },
      ],
    });
  });
  if (!repeated.length)
    out.push(
      finding(group, "missing_independent_corroboration", {
        title: `Independent sources back competitors in "${group.topic}", not you`,
        summary: `${missing.length} answers that name a competitor without you cite third-party sites (${domains.length} domain(s)). No single site repeats yet.`,
        suggestedAction:
          "Build independent mentions of your brand on the kinds of sites these answers cite (reviews, directories, industry press).",
        action: "earn_third_party_coverage",
        effort: {
          level: "high",
          reason: "several third-party placements over time",
        },
        answers: missing,
        sources: domains,
      }),
    );
  return out;
}

function brandInformation(group: Group): CitationGapFinding | null {
  const against = group.answered.filter((f) => ownOf(f)?.recommended === false);
  if (!against.length) return null;
  return finding(group, "brand_information_review", {
    title: `Answers in "${group.topic}" recommend against you`,
    summary: `${against.length} answer(s) use explicit wording against recommending you. Whether what they say is accurate cannot be checked automatically; read them.`,
    suggestedAction:
      "Read these answers, and correct outdated or wrong facts on your site and the sources they cite.",
    action: "review_brand_information",
    effort: {
      level: "low",
      reason: "reading the answers; fixes depend on what they say",
    },
    answers: against,
  });
}

function measurementNote(group: Group): CitationGapFinding | null {
  const notes = uncertainty(group);
  if (!notes.length) return null;
  return finding(group, "measurement_uncertainty", {
    title: `"${group.topic}" needs more measurement before acting`,
    summary: notes.join(" "),
    suggestedAction:
      "Collect more runs of this prompt set before relying on these findings. Nothing is collected automatically from here.",
    action: null,
    effort: { level: "low", reason: "more scheduled runs" },
    answers: group.answered,
  });
}

/** Every finding, per prompt group. Groups with no answered collections give none. */
export function detectCitationGaps(
  facts: IntelFact[],
  sources: CitedSource[],
): CitationGapFinding[] {
  const answeredAll = facts.filter(isAnswered);
  const tracked = [
    ...new Map(
      answeredAll
        .flatMap((f) => f.brands)
        .map((b) => [
          b.domain,
          { domain: b.domain, name: b.name || b.domain, own: b.own },
        ]),
    ).values(),
  ];
  const bySource = sourcesByAnswer(facts, sources);
  const totalPrompts = new Set(facts.map((f) => f.promptId)).size;
  const findings = [...groupInto(facts, (f) => f.topic)].flatMap(
    ([topic, planned]) => {
      const answered = planned.filter(isAnswered);
      if (!answered.length) return [];
      const group: Group = {
        topic,
        answered,
        planned,
        sources: bySource,
        tracked,
        totalPrompts,
      };
      return [
        contentGap(group),
        comparisonGap(group),
        ...thirdPartyFindings(group),
        brandInformation(group),
        measurementNote(group),
      ].filter((f): f is CitationGapFinding => f !== null);
    },
  );
  const rank = { high: 0, medium: 1, low: 2 };
  return sort(
    findings,
    (a, b) =>
      Number(a.action === null) - Number(b.action === null) ||
      rank[a.priority] - rank[b.priority] ||
      a.promptGroup.localeCompare(b.promptGroup) ||
      a.key.localeCompare(b.key),
  );
}
