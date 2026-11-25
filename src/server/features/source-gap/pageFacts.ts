import type {
  CommercialFactKey,
  ComparisonSignalKey,
  PageKind,
  ParsedPage,
  ParsedTable,
  TableKind,
} from "@/shared/source-gap";
import { clean, type RawTable } from "./pageTokenizer";

const SNIPPET = 70;

function snippet(text: string, index: number, length: number): string {
  return clean(
    text.slice(Math.max(0, index - SNIPPET), index + length + SNIPPET),
  );
}

export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function tableKind(table: RawTable): TableKind {
  const headers = table.headers.join(" ").toLowerCase();
  const body = table.cells.join(" ").toLowerCase();
  // A table whose rows are products is a comparison even with a price column.
  if (
    /^(tool|product|app|software|service|provider|company|brand|option|name)s?\b/.test(
      (table.headers[0] ?? "").toLowerCase(),
    ) &&
    table.headers.length >= 3 &&
    table.rows >= 3
  )
    return "comparison";
  if (
    /price|pricing|plan|cost|per (minute|hour|month|user|seat)/.test(headers) ||
    (/[$€£]\s?\d/.test(body) && table.headers.length >= 2)
  )
    return "pricing";
  if (/feature|support|platform|language|limit|integration/.test(headers))
    return table.headers.length >= 3 ? "comparison" : "feature";
  if (table.headers.length >= 3 && table.rows >= 2) return "comparison";
  return "other";
}

export function summarizeTables(tables: RawTable[]): ParsedTable[] {
  return tables.map((t) => ({
    kind: tableKind(t),
    headers: t.headers,
    rows: t.rows,
  }));
}

type JsonLd = {
  types: string[];
  published: string | null;
  modified: string | null;
  authors: string[];
  faq: boolean;
};

function visitJsonLd(out: JsonLd, node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) visitJsonLd(out, item);
    return;
  }
  if (!node || typeof node !== "object") return;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object above
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  for (const t of Array.isArray(type) ? type : [type])
    if (typeof t === "string") out.types.push(t);
  if (typeof obj.datePublished === "string")
    out.published ??= toIso(obj.datePublished);
  if (typeof obj.dateModified === "string")
    out.modified ??= toIso(obj.dateModified);
  const author = obj.author;
  for (const a of Array.isArray(author) ? author : [author]) {
    if (typeof a === "string") out.authors.push(a);
    else if (a && typeof a === "object") {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object above
      const name = (a as Record<string, unknown>).name;
      if (typeof name === "string") out.authors.push(name);
    }
  }
  if (obj["@graph"]) visitJsonLd(out, obj["@graph"]);
  if (obj.mainEntity) visitJsonLd(out, obj.mainEntity);
}

export function readJsonLd(blocks: string[]): JsonLd {
  const out: JsonLd = {
    types: [],
    published: null,
    modified: null,
    authors: [],
    faq: false,
  };
  for (const block of blocks) {
    try {
      visitJsonLd(out, JSON.parse(block));
    } catch {
      // A malformed block is ignored, not guessed at.
    }
  }
  out.faq = out.types.includes("FAQPage");
  return out;
}

const COMMERCIAL: [CommercialFactKey, RegExp][] = [
  ["price", /[$€£]\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?\/\s?\w+)?/i],
  ["payAsYouGo", /pay[\s-]*as[\s-]*you[\s-]*go|\bpayg\b|pay[\s-]per[\s-]use/i],
  [
    "noSubscription",
    /no[\s-]+(?:monthly[\s-]+)?(?:subscription|commitment|contract)s?|without (?:a )?subscription|subscription[\s-]free|never (?:a )?subscription/i,
  ],
  [
    "subscription",
    /\bsubscriptions?\b|\bper month\b|\/\s?(?:mo|month)\b|monthly plan/i,
  ],
  [
    "freeTier",
    /free (?:tier|plan|forever|version)|free to (?:start|use|try)|\bfree minutes\b/i,
  ],
  ["trial", /free trial|\btrial\b/i],
  ["refund", /\brefunds?\b|money[\s-]back/i],
  [
    "lifetime",
    /lifetime (?:deal|license|access|plan)|one[\s-]time (?:payment|purchase|fee)/i,
  ],
  ["perSeat", /per[\s-](?:seat|user)|\/\s?(?:seat|user)\b/i],
  ["perMinute", /per[\s-]minute|\/\s?min(?:ute)?\b|a minute\b/i],
  ["perHour", /per[\s-]hour|\/\s?(?:hr|hour)\b|an hour\b/i],
  ["credits", /\bcredits?\b/i],
];

const FIRST_HAND = [
  /\bwe (?:tested|tried|compared|ran|benchmarked|evaluated)\b/i,
  /\bi (?:tested|tried|used|compared|ran)\b/i,
  /\bhands[\s-]on\b/i,
  /\bin (?:our|my) (?:testing|tests|experience|review)\b/i,
  /\b(?:sample|example) (?:output|transcript|recording|result)s?\b/i,
  /\bbenchmarks?\b/i,
  /\baccuracy (?:rate|test|score)\b|\bword error rate\b/i,
];

const METHODOLOGY =
  /\bmethodolog|how we (?:test|tested|rank|review|chose|choose|evaluate|evaluated|picked)\b|our (?:testing|review) process\b/i;

const CREDENTIALS =
  /\b(?:ph\.?d\.?|m\.?d\.?|cpa|j\.?d\.?|professor|editor[\s-]in[\s-]chief|senior (?:editor|writer|analyst)|certified [a-z ]{3,30}|journalist|attorney|engineer)\b/gi;

export function commercialFacts(visible: string): ParsedPage["commercial"] {
  const out: ParsedPage["commercial"] = {};
  for (const [key, pattern] of COMMERCIAL) {
    const match = pattern.exec(visible);
    if (match) out[key] = snippet(visible, match.index, match[0].length);
  }
  return out;
}

const HEADING_SIGNALS: [ComparisonSignalKey, RegExp][] = [
  ["alternativesList", /alternatives?\b/i],
  ["prosCons", /\bpros\b.*\bcons\b|\bpros and cons\b/i],
  ["bestFor", /\bbest for\b|\bwho (?:it'?s|is it) for\b/i],
  [
    "verdict",
    /\bverdict\b|\bbottom line\b|\bour pick\b|\bwhich (?:one )?(?:should|to) (?:you )?(?:choose|pick|use)\b/i,
  ],
  ["comparisonHeading", /\bvs\.?\b|\bversus\b|\bcompar(?:e|ison)\b/i],
];

const BODY_SIGNALS: [ComparisonSignalKey, RegExp][] = [
  ["bestFor", /\bbest for\b/i],
  ["prosCons", /\bpros\b[\s\S]{0,40}\bcons\b/i],
  ["verdict", /\b(?:our verdict|the verdict|bottom line|our pick)\b/i],
];

export function comparisonSignals(
  tables: ParsedTable[],
  headings: string[],
  visible: string,
): ParsedPage["comparison"] {
  const out: ParsedPage["comparison"] = {};
  const set = (key: ComparisonSignalKey, evidence: string) => {
    out[key] ??= evidence;
  };
  for (const table of tables) {
    const label = table.headers.join(" | ").slice(0, 100);
    if (table.kind === "comparison") set("comparisonTable", label);
    if (table.kind === "pricing") set("pricingTable", label);
    if (table.kind === "feature" || table.kind === "comparison")
      set("featureMatrix", label);
  }
  for (const h of headings)
    for (const [key, pattern] of HEADING_SIGNALS)
      if (pattern.test(h)) set(key, h);
  for (const [key, pattern] of BODY_SIGNALS) {
    const match = pattern.exec(visible);
    if (match && !out[key])
      out[key] = snippet(visible, match.index, match[0].length);
  }
  return out;
}

export function firstHandEvidence(visible: string): string[] {
  const out: string[] = [];
  for (const pattern of FIRST_HAND) {
    const match = pattern.exec(visible);
    if (match) out.push(snippet(visible, match.index, match[0].length));
  }
  return out.slice(0, 5);
}

export function hasMethodology(visible: string): boolean {
  return METHODOLOGY.test(visible.toLowerCase());
}

export function credentialsOn(visible: string): string[] {
  return [
    ...new Set(
      [...visible.matchAll(CREDENTIALS)].map((m) => m[0].toLowerCase()),
    ),
  ].slice(0, 5);
}

export function reviewerOn(visible: string): string | null {
  return (
    /reviewed by\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3})/.exec(
      visible,
    )?.[1] ?? null
  );
}

export function visibleUpdate(visible: string): string | null {
  const match =
    /(?:last\s+)?(?:updated|modified)[:\s]+(?:on\s+)?([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]{2,8}\.? \d{4}|\d{4}-\d{2}-\d{2})/.exec(
      visible,
    );
  return match ? toIso(match[1]) : null;
}

export function pageKind(
  url: string,
  title: string,
  h1: string,
  schemaTypes: string[],
  comparisonSignalCount: number,
): PageKind {
  let path = "/";
  try {
    path = new URL(url).pathname;
  } catch {
    // Keep "/".
  }
  const heading = `${title} ${h1}`.toLowerCase();
  if (path.replace(/\/+$/, "") === "") return "home";
  if (/\/pricing\b|\/plans\b/.test(path) || /^pricing\b/.test(heading))
    return "pricing";
  if (/\/docs?\/|\/help\/|\/support\/|\/developers?\//.test(path))
    return "documentation";
  if (
    comparisonSignalCount > 0 ||
    /\b(best|top \d+|alternatives?|vs\.?|versus|compared?|comparison|review)\b/.test(
      heading,
    )
  )
    return "comparison";
  if (schemaTypes.some((t) => /Article|BlogPosting|NewsArticle/.test(t)))
    return "article";
  if (schemaTypes.some((t) => /Product|SoftwareApplication/.test(t)))
    return "product";
  return "other";
}
