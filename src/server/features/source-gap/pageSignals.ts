import { tokenize } from "@/server/features/content/rules/opportunityRules";
import type {
  CommercialFactKey,
  ComparisonSignalKey,
  ParsedPage,
  SourceType,
} from "@/shared/source-gap";

/** Words in a question that say nothing about the topic being asked about. */
const QUESTION_WORDS = new Set([
  "which",
  "what",
  "how",
  "best",
  "tool",
  "tools",
  "app",
  "apps",
  "software",
  "does",
  "do",
  "is",
  "are",
  "can",
  "should",
  "work",
  "works",
  "use",
  "good",
  "any",
  "there",
  "on",
  "with",
  "that",
  "i",
  "my",
  "me",
  "you",
  "your",
  "or",
  "vs",
  "versus",
  "than",
  "if",
  "it",
  "be",
  "get",
  "need",
  "want",
  "like",
]);

// Longest first, so "dictating" and "dictation" both reach "dict".
const SUFFIXES = [
  "ations",
  "ation",
  "ating",
  "ated",
  "ates",
  "ate",
  "ing",
  "ed",
  "e",
];

/** Plural and common verb endings off, so "dictate", "dictation" and "dictating" match. */
function stem(token: string): string {
  let word = token;
  if (word.length > 4 && word.endsWith("ies")) word = `${word.slice(0, -3)}y`;
  else if (word.length > 3 && word.endsWith("s")) word = word.slice(0, -1);
  if (word.length < 5) return word;
  const suffix = SUFFIXES.find(
    (s) => word.endsWith(s) && word.length - s.length >= 3,
  );
  return suffix ? word.slice(0, -suffix.length) : word;
}

/** The topic words of a prompt, stemmed, without question filler. */
export function topicTokens(text: string): string[] {
  return [
    ...new Set(
      tokenize(text)
        .filter((t) => !QUESTION_WORDS.has(t))
        .map(stem),
    ),
  ];
}

/** How much each topic word of a prompt counts when pages are compared, by stem. */
export type TopicWeights = Map<string, number>;

const MIN_TOPIC_WEIGHT = 0.15;
/** How much of a weighted share comes from rare words rather than the plain share. */
const RARE_SHARE = 0.5;
/** Fewer pages than this say too little about which words are common. */
const MIN_PAGES_FOR_WEIGHTS = 3;

/**
 * A word that nearly every page of a site uses (its own subject) says little
 * about which page answers the prompt; a word few pages use says a lot. Weight
 * each topic word by how rare it is across the pages being compared.
 */
export function topicWeights(prompt: string, texts: string[]): TopicWeights {
  const weights: TopicWeights = new Map();
  const pages = texts.map((t) => new Set(tokenize(t).map(stem)));
  for (const token of topicTokens(prompt)) {
    if (pages.length < MIN_PAGES_FOR_WEIGHTS) {
      weights.set(token, 1);
      continue;
    }
    const uses = pages.filter((p) => p.has(token)).length;
    weights.set(token, Math.max(MIN_TOPIC_WEIGHT, 1 - uses / pages.length));
  }
  return weights;
}

/** Share of the prompt's topic words that appear in the text, 0 to 1; when weights are given, half the score counts rare words for more. */
export function topicCoverage(
  prompt: string,
  text: string,
  weights?: TopicWeights,
): number {
  const wanted = topicTokens(prompt);
  if (wanted.length === 0) return 0;
  const have = new Set(tokenize(text).map(stem));
  const plain = wanted.filter((t) => have.has(t)).length / wanted.length;
  if (!weights) return plain;
  const weightOf = (t: string) => weights.get(t) ?? 1;
  const total = wanted.reduce((sum, t) => sum + weightOf(t), 0);
  const found = wanted
    .filter((t) => have.has(t))
    .reduce((sum, t) => sum + weightOf(t), 0);
  return plain * (1 - RARE_SHARE) + (found / total) * RARE_SHARE;
}

/** A page with fewer words than this was read, but not enough to judge. */
export const THIN_PAGE_WORDS = 80;

/** The prompt's topic words, as written, that the text never uses. */
export function uncoveredTopicWords(prompt: string, text: string): string[] {
  const have = new Set(tokenize(text).map(stem));
  const seen = new Set<string>();
  return tokenize(prompt).filter((word) => {
    const root = stem(word);
    if (QUESTION_WORDS.has(word) || have.has(root) || seen.has(root))
      return false;
    seen.add(root);
    return true;
  });
}

type IntentLabel = "high" | "medium" | "low";

function intentLabel(score: number): IntentLabel {
  return score >= 0.6 ? "high" : score >= 0.34 ? "medium" : "low";
}

/** The page's title and H1, shown once when they say the same thing. */
export function headingOf(page: ParsedPage): string {
  const title = page.title ?? "";
  const h1 = page.h1s[0] ?? "";
  return (title.trim() === h1.trim() ? title : `${title} ${h1}`).trim();
}

/** How directly a page's title and H1 speak to the prompt. */
export function intentAlignment(prompt: string, page: ParsedPage) {
  const heading = headingOf(page);
  const score = topicCoverage(prompt, heading);
  return { score, label: intentLabel(score), heading };
}

const COMPARATIVE =
  /\b(best|top|vs\.?|versus|compare|compared|comparison|alternatives?|which|or)\b/i;

/** A prompt that asks to choose between options. */
export function isComparativePrompt(
  prompt: string,
  intent: string | null,
): boolean {
  return (
    intent === "comparison" ||
    intent === "alternatives" ||
    intent === "recommendation" ||
    intent === "category_discovery" ||
    COMPARATIVE.test(prompt)
  );
}

const COMMERCIAL_PROMPT =
  /\b(price|prices|pricing|cost|costs|cheap|cheapest|free|afford\w*|subscription|pay|paid|plan|plans|lifetime|credits?|per (minute|hour|month))\b/i;

const COST_QUESTION =
  /\b(price|prices|pricing|cost|costs|how much|fee|fees|subscription|cheap|cheapest|afford\w*|per (minute|hour|month|user|seat))\b/i;

/** A prompt whose answer is a price or a billing term. */
export function asksAboutCost(prompt: string): boolean {
  return COST_QUESTION.test(prompt);
}

/** A prompt that asks about what something costs or how it is billed. */
export function isCommercialPrompt(
  prompt: string,
  intent: string | null,
): boolean {
  return (
    COMMERCIAL_PROMPT.test(prompt) ||
    intent === "recommendation" ||
    intent === "comparison" ||
    intent === "alternatives"
  );
}

export function isBuyerIntent(intent: string | null, prompt: string): boolean {
  return (
    isComparativePrompt(prompt, intent) || isCommercialPrompt(prompt, intent)
  );
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys come from the same record
const COMMERCIAL_KEYS = Object.keys({
  price: 1,
  payAsYouGo: 1,
  noSubscription: 1,
  subscription: 1,
  freeTier: 1,
  trial: 1,
  refund: 1,
  lifetime: 1,
  perSeat: 1,
  perMinute: 1,
  perHour: 1,
  credits: 1,
} satisfies Record<CommercialFactKey, 1>) as CommercialFactKey[];

export function commercialKeys(page: ParsedPage): CommercialFactKey[] {
  return COMMERCIAL_KEYS.filter((k) => page.commercial[k]);
}

export function comparisonKeys(page: ParsedPage): ComparisonSignalKey[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys come from the same record
  return (Object.keys(page.comparison) as ComparisonSignalKey[]).filter(
    (k) => page.comparison[k],
  );
}

/** Any signal that the page helps a reader choose between options. */
export function hasComparisonStructure(page: ParsedPage): boolean {
  return comparisonKeys(page).some((k) =>
    [
      "comparisonTable",
      "alternativesList",
      "verdict",
      "bestFor",
      "prosCons",
    ].includes(k),
  );
}

/** Whether a page says which option to choose, rather than describing one. */
export function answersWhichToChoose(page: ParsedPage): boolean {
  return !!(page.comparison.verdict || page.comparison.bestFor);
}

export function structuredTableCount(page: ParsedPage): number {
  return page.tables.filter((t) => t.kind !== "other").length;
}

type FirstHandLevel = "none" | "low" | "medium" | "high";
export const FIRST_HAND_RANK: Record<FirstHandLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * How much a page shows of having been tried or tested. Wording on a vendor's
 * own page is a claim, so it never rates above "low"; a third-party page
 * needs its method stated before it rates "high".
 */
export function firstHandLevel(
  page: ParsedPage,
  type: SourceType,
): FirstHandLevel {
  const signals = page.firstHand.length;
  if (signals === 0 && !page.methodology) return "none";
  if (type === "own" || type === "competitor_owned")
    return signals > 0 ? "low" : "none";
  if (page.methodology && signals >= 2) return "high";
  if (page.methodology || signals >= 2) return "medium";
  return "low";
}

export function expertSignalCount(page: ParsedPage): number {
  return (
    (page.author ? 1 : 0) +
    (page.reviewer ? 1 : 0) +
    (page.credentials.length > 0 ? 1 : 0) +
    (page.methodology ? 1 : 0)
  );
}

/** Newest date the page shows, as an ISO string, or null. */
export function pageDate(page: ParsedPage): string | null {
  return page.modifiedAt ?? page.visibleUpdated ?? page.publishedAt;
}

const DAY_MS = 86_400_000;

export function ageDays(date: string | null, now: Date): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isNaN(t)
    ? null
    : Math.max(0, Math.round((now.getTime() - t) / DAY_MS));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Entities from the vocabulary that the page's text names. */
export function entitiesOn(page: ParsedPage, vocabulary: string[]): string[] {
  const text = `${page.title ?? ""} ${page.h1s.join(" ")} ${page.text}`;
  return vocabulary.filter((entity) => mentions(text, entity));
}

function mentions(text: string, entity: string): boolean {
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegex(entity)}([^a-z0-9]|$)`,
    "i",
  ).test(text);
}

const PLATFORM_TERMS = [
  "Mac",
  "macOS",
  "Windows",
  "Linux",
  "iPhone",
  "iOS",
  "Android",
  "Chrome",
  "Zoom",
  "Slack",
  "Teams",
  "Google Meet",
  "offline",
  "API",
  "Zapier",
];

/**
 * Names worth checking each page for: the tracked brands and the brands the
 * answers named, plus a platform or integration only when the prompt itself
 * mentions it (a page naming Slack is incidental to a prompt that never does).
 * It is a fixed vocabulary, not a general entity extractor.
 */
export function entityVocabulary(
  brandNames: string[],
  promptText: string,
): string[] {
  const platforms = PLATFORM_TERMS.filter((term) => mentions(promptText, term));
  return [
    ...new Set([...brandNames.filter((n) => n.length > 1), ...platforms]),
  ];
}
