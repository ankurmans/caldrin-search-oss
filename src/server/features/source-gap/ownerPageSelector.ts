import type { ParsedPage } from "@/shared/source-gap";
import type {
  DiscoverySource,
  OwnerCandidate,
  OwnerConfidence,
  OwnerPageType,
  OwnerSelection,
  RetrievalState,
} from "@/shared/source-gap-owner";
import { isHomepageUrl, normalizeSourceUrl } from "./sourceUrl";
import {
  asksAboutCost,
  headingOf,
  topicCoverage,
  topicTokens,
  topicWeights,
  type TopicWeights,
} from "./pageSignals";
import { ownerPageType, pageTypeFit, promptWants } from "./ownerPageType";
import { readPageContent } from "./pagePurpose";

/** Below this score a page is not offered as the owner. */
const MIN_OWNER_SCORE = 0.25;
/**
 * A page at or above this score is a plausible owner even when it is too weak
 * to be picked: it has to be looked at before a new page is suggested.
 */
export const PLAUSIBLE_OWNER_SCORE = 0.12;
/** A page that is the wrong kind for the prompt keeps this much of its score, the right kind up to the cap. */
const TYPE_FACTOR_MIN = 0.5;
const TYPE_FACTOR_RANGE = 0.65;
const WEIGHTS = {
  intentAlignment: 0.4,
  slugMatch: 0.25,
  gscQueryOverlap: 0.2,
  entityMatch: 0.15,
  factMatch: 0.2,
} as const;
/** A read page whose purpose could not be established: neither the right kind nor the wrong kind for a typed question. */
const UNKNOWN_PURPOSE_FIT = 0.5;
const CLOSE_CALL = 0.05;
const MAX_CANDIDATES = 8;

export interface OwnerInput {
  url: string;
  /** Title from a crawl, when no page copy has been read yet. */
  title?: string | null;
  /** The read page, when there is one; it replaces the crawl title. */
  page?: ParsedPage | null;
  /** Search Console queries this page earned impressions for. */
  gscQueries?: string[];
  /** Where the address was found. */
  discoveredVia?: DiscoverySource[];
  /** Other addresses that turned out to be this same page. */
  alsoListedAs?: string[];
  /** What came of reading the page. */
  retrieval?: RetrievalState;
}

const union = <T>(a: T[] | undefined, b: T[] | undefined): T[] => [
  ...new Set([...(a ?? []), ...(b ?? [])]),
];

type Signals = OwnerCandidate["signals"];

function slugText(url: string): string {
  try {
    return new URL(url).pathname.replace(/[-_/.]+/g, " ");
  } catch {
    return url;
  }
}

function weighted(signals: Record<keyof Signals, number | null>): number {
  let total = 0;
  let weight = 0;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys come from the same record
  for (const key of Object.keys(WEIGHTS) as (keyof Signals)[]) {
    const value = signals[key];
    if (value === null) continue;
    total += value * WEIGHTS[key];
    weight += WEIGHTS[key];
  }
  return weight === 0 ? 0 : total / weight;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function reasons(
  signals: Record<keyof Signals, number | null>,
  gscQueries: number,
): string[] {
  const out: string[] = [];
  if (signals.intentAlignment !== null)
    out.push(
      `Title and H1 cover ${pct(signals.intentAlignment)} of the prompt's topic words`,
    );
  if (signals.slugMatch)
    out.push(`Address matches ${pct(signals.slugMatch)} of the topic words`);
  if (signals.gscQueryOverlap)
    out.push(
      `${gscQueries} Search Console quer${gscQueries === 1 ? "y" : "ies"} for this page overlap the prompt (${pct(signals.gscQueryOverlap)})`,
    );
  if (signals.factMatch)
    out.push("The page states prices, which the prompt asks about");
  if (signals.entityMatch !== null && signals.entityMatch > 0)
    out.push(
      `Headings and opening text cover ${pct(signals.entityMatch)} of the topic words`,
    );
  return out;
}

function typeReason(
  type: OwnerPageType,
  fit: number | null,
  options: number | null,
): string[] {
  if (fit === null) return [];
  if (type === "unknown")
    return ["The page's purpose could not be established from its content"];
  const label = {
    how_to: "a how-to guide",
    comparison: "a comparison page",
    pricing: "a pricing page",
    product: "a page about one product",
  }[type];
  const body =
    options === null
      ? ""
      : options >= 2
        ? ` (the page sets ${options} products side by side)`
        : " (the page does not compare products)";
  return [
    fit >= 0.6
      ? `Reads as ${label}${body}, which fits what the prompt asks`
      : `Reads as ${label}${body}, which fits what the prompt asks poorly`,
  ];
}

export function scoreOwnerCandidate(
  prompt: string,
  input: OwnerInput,
  intent: string | null = null,
  weights?: TopicWeights,
): OwnerCandidate {
  const page = input.page ?? null;
  const heading = page ? headingOf(page) : (input.title ?? "");
  const queries = input.gscQueries ?? [];
  const intentAlignment = heading.trim()
    ? topicCoverage(prompt, heading, weights)
    : null;
  const slugMatch = topicCoverage(prompt, slugText(input.url), weights);
  const gscQueryOverlap = queries.length
    ? topicCoverage(prompt, queries.slice(0, 10).join(" "))
    : null;
  const entityMatch = page
    ? topicCoverage(
        prompt,
        `${page.h2s.join(" ")} ${page.h3s.join(" ")} ${page.text.slice(0, 3000)}`,
        weights,
      )
    : null;
  // A question about cost is answered by a page that states a price, whatever
  // words it uses for it.
  const factMatch =
    page && asksAboutCost(prompt)
      ? page.commercial.price
        ? 1
        : Object.keys(page.commercial).length
          ? 0.6
          : 0
      : null;
  const signals = {
    intentAlignment,
    slugMatch,
    gscQueryOverlap,
    entityMatch,
    factMatch,
  };
  const pageType = ownerPageType(input.url, heading, page);
  const wants = promptWants(prompt, intent);
  const fit =
    pageTypeFit(wants, pageType, prompt, intent) ??
    (page && wants && pageType === "unknown" ? UNKNOWN_PURPOSE_FIT : null);
  const optionsCompared = page ? readPageContent(page).optionsCompared : null;
  const topical = weighted(signals);
  // Type only adjusts a page that already speaks to the topic, so a comparison
  // page about something else never becomes the owner for being a comparison.
  const score =
    fit === null
      ? topical
      : Math.min(1, topical * (TYPE_FACTOR_MIN + TYPE_FACTOR_RANGE * fit));
  return {
    url: input.url,
    title: page?.title ?? input.title ?? null,
    score,
    pageType,
    ...(fit === null ? {} : { typeFit: fit }),
    ...(optionsCompared === null ? {} : { optionsCompared }),
    ...(input.discoveredVia ? { discoveredVia: input.discoveredVia } : {}),
    ...(input.retrieval ? { retrieval: input.retrieval } : {}),
    ...(input.alsoListedAs?.length ? { alsoListedAs: input.alsoListedAs } : {}),
    ...(page ? { finalUrl: page.finalUrl } : {}),
    ...(page?.canonical &&
    normalizeSourceUrl(page.canonical) !== normalizeSourceUrl(page.finalUrl)
      ? { declaredCanonical: page.canonical }
      : {}),
    reasons: [
      ...reasons(signals, queries.length),
      ...typeReason(pageType, fit, optionsCompared),
    ],
    signals: {
      intentAlignment: intentAlignment ?? 0,
      slugMatch,
      gscQueryOverlap: gscQueryOverlap ?? 0,
      entityMatch: entityMatch ?? 0,
      factMatch: factMatch ?? 0,
    },
  };
}

/** A page whose canonical tag names another listed page is that page, so it is scored once, under the canonical address. */
function mergeCanonicalPages(
  byKey: Map<string, OwnerInput>,
): Map<string, OwnerInput> {
  const merged = new Map(byKey);
  for (const [key, input] of byKey) {
    const canonical = input.page?.canonical
      ? normalizeSourceUrl(input.page.canonical)
      : null;
    const target =
      canonical && canonical !== key ? merged.get(canonical) : null;
    if (!canonical || !target) continue;
    merged.set(canonical, {
      ...target,
      page: target.page ?? input.page,
      title: target.title ?? input.title,
      gscQueries: [...(target.gscQueries ?? []), ...(input.gscQueries ?? [])],
      discoveredVia: union(target.discoveredVia, input.discoveredVia),
      alsoListedAs: union(target.alsoListedAs, [
        ...(input.alsoListedAs ?? []),
        input.url,
      ]),
    });
    merged.delete(key);
  }
  return merged;
}

/** Candidates best first, front page left out, one entry per distinct page. */
export function rankOwnerCandidates(
  prompt: string,
  inputs: OwnerInput[],
  intent: string | null = null,
): OwnerCandidate[] {
  if (topicTokens(prompt).length === 0) return [];
  const byKey = new Map<string, OwnerInput>();
  for (const input of inputs) {
    const key = normalizeSourceUrl(input.url);
    if (!key || isHomepageUrl(input.url)) continue;
    const kept = byKey.get(key);
    byKey.set(key, {
      ...input,
      page: input.page ?? kept?.page,
      title: input.title ?? kept?.title,
      gscQueries: [...(kept?.gscQueries ?? []), ...(input.gscQueries ?? [])],
      discoveredVia: union(kept?.discoveredVia, input.discoveredVia),
      alsoListedAs: union(kept?.alsoListedAs, input.alsoListedAs),
      retrieval: input.retrieval ?? kept?.retrieval,
    });
  }
  const merged = [...mergeCanonicalPages(byKey).values()];
  const weights = topicWeights(
    prompt,
    merged.map(
      (input) =>
        `${slugText(input.url)} ${input.page ? headingOf(input.page) : (input.title ?? "")} ${input.page?.text.slice(0, 3000) ?? ""}`,
    ),
  );
  // Words most pages use count for less when deciding which page is best; the
  // score that confidence and thresholds read stays on the plain scale.
  const pairs = merged.map((input) => ({
    candidate: scoreOwnerCandidate(prompt, input, intent),
    order: scoreOwnerCandidate(prompt, input, intent, weights).score,
  }));
  pairs.sort(
    (a, b) =>
      b.order - a.order || a.candidate.url.localeCompare(b.candidate.url),
  );
  const scored = pairs.map((p) => p.candidate);
  return scored.slice(0, MAX_CANDIDATES).map((candidate, i, list) => ({
    ...candidate,
    confidence: confidenceFor(candidate, i === 0 ? list[1] : list[0]),
  }));
}

function confidenceFor(
  best: OwnerCandidate,
  runnerUp: OwnerCandidate | undefined,
): OwnerConfidence {
  let level: OwnerConfidence =
    best.score >= 0.6 && best.signals.intentAlignment >= 0.5
      ? "high"
      : best.score >= 0.4
        ? "medium"
        : "low";
  if (
    runnerUp &&
    Math.abs(best.score - runnerUp.score) < CLOSE_CALL &&
    level === "high"
  )
    level = "medium";
  // The wrong kind of page for the question is never a confident owner.
  if (best.typeFit === 0) level = "low";
  // A page whose purpose is unclear, or whose text was too thin to judge, has
  // not earned more than a middling confidence.
  const unclear = best.typeFit !== undefined && best.pageType === "unknown";
  if (
    (unclear || best.retrieval === "FETCHED_INSUFFICIENT_CONTENT") &&
    level === "high"
  )
    level = "medium";
  return level;
}

/**
 * The owner page of a prompt: a person's choice if there is one, otherwise the
 * best-scoring candidate. A page scoring under the minimum is not offered, so a
 * weak page is never compared as if it were the answer to the prompt.
 */
export function selectOwner(
  prompt: string,
  candidates: OwnerCandidate[],
  override: { url: string; candidate: OwnerCandidate | null } | null,
): OwnerSelection {
  const notes: string[] = [];
  if (override) {
    const candidate =
      override.candidate ??
      ({
        url: override.url,
        title: null,
        score: 1,
        reasons: ["Chosen by a person"],
        signals: {
          intentAlignment: 0,
          slugMatch: 0,
          gscQueryOverlap: 0,
          entityMatch: 0,
          factMatch: 0,
        },
      } satisfies OwnerCandidate);
    return {
      selected: {
        ...candidate,
        reasons: ["Chosen by a person", ...candidate.reasons],
      },
      // A person's choice is not something Caldrin verified, so it has no confidence.
      confidence: null,
      candidates,
      overridden: true,
      notes,
    };
  }
  const [best, runnerUp] = candidates;
  if (!best || best.score < MIN_OWNER_SCORE) {
    notes.push(
      best
        ? `The closest page scored ${best.score.toFixed(2)}, under the ${MIN_OWNER_SCORE} needed to call it the page for this prompt.`
        : "No candidate page was found from the sitemap, crawl or Search Console.",
    );
    return {
      selected: null,
      confidence: null,
      candidates,
      overridden: false,
      notes,
    };
  }
  const confidence = confidenceFor(best, runnerUp);
  if (confidence === "low")
    notes.push("This is a weak match. Confirm it or choose a better page.");
  if (runnerUp && best.score - runnerUp.score < CLOSE_CALL)
    notes.push(`${runnerUp.url} scored almost the same.`);
  return { selected: best, confidence, candidates, overridden: false, notes };
}
