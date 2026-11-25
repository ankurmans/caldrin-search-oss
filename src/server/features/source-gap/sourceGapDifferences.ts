import {
  COMMERCIAL_FACT_LABELS,
  COMPARISON_SIGNAL_LABELS,
  type CitedSourceSummary,
  type ConsensusPattern,
  type DimensionRow,
  type DimensionVerdict,
  type GapDimensionKey,
  type ParsedPage,
  type SourceDifference,
} from "@/shared/source-gap";
import {
  ageDays,
  answersWhichToChoose,
  commercialKeys,
  comparisonKeys,
  entitiesOn,
  expertSignalCount,
  firstHandLevel,
  FIRST_HAND_RANK,
  hasComparisonStructure,
  intentAlignment,
  pageDate,
  structuredTableCount,
} from "./pageSignals";
import { isThirdParty } from "./sourceClassification";

const YEAR_DAYS = 365;
const DATE_GAP_DAYS = 180;
const RECURRING_SHARE = 0.5;

export interface DiffInput {
  prompt: string;
  now: Date;
  /** The owner page, or null in the no-owner state. */
  owner: ParsedPage | null;
  sources: CitedSourceSummary[];
  vocabulary: string[];
  ownBrandNames: string[];
  /** Tracked competitors, for counting how many a page names. */
  competitorNames: string[];
}

const listOrNone = (items: string[]) =>
  items.length ? items.join(", ") : "none";

function compare(cited: number, yours: number, margin = 0): DimensionVerdict {
  if (cited - yours > margin) return "cited_stronger";
  if (yours - cited > margin) return "yours_stronger";
  return "similar";
}

/** Pages whose text could be read, leaving out the project's own pages. */
export function readableCompetitors(sources: CitedSourceSummary[]) {
  return sources.filter(
    (s) =>
      s.sourceType !== "own" && s.snapshot?.status === "ok" && s.snapshot.page,
  );
}

function row(
  dimension: GapDimensionKey,
  cited: string,
  yours: string,
  verdict: DimensionVerdict,
): DimensionRow {
  return { dimension, cited, yours, verdict };
}

function datedText(page: ParsedPage, now: Date): string {
  const date = pageDate(page);
  const age = ageDays(date, now);
  return date && age !== null
    ? `${date.slice(0, 10)} (${age} days ago)`
    : "no date on the page";
}

type RowContext = {
  source: CitedSourceSummary;
  page: ParsedPage;
  /** The owner page, or null in the no-owner state. */
  mine: ParsedPage | null;
  input: DiffInput;
};

const NO_OWNER = "No owner page";
const DAY_MS = 86_400_000;

const authorText = (p: ParsedPage) =>
  [
    p.author && `author ${p.author}`,
    p.reviewer && `reviewer ${p.reviewer}`,
    p.credentials.length ? "credentials" : null,
  ]
    .filter(Boolean)
    .join(", ") || "none shown";

const tableText = (p: ParsedPage) =>
  structuredTableCount(p)
    ? `${structuredTableCount(p)} (${[...new Set(p.tables.filter((t) => t.kind !== "other").map((t) => t.kind))].join(", ")})`
    : "none";

const factLabels = (keys: ReturnType<typeof commercialKeys>) =>
  listOrNone(keys.map((k) => COMMERCIAL_FACT_LABELS[k]));

const signalLabels = (keys: ReturnType<typeof comparisonKeys>) =>
  listOrNone(keys.map((k) => COMPARISON_SIGNAL_LABELS[k]));

const intentText = (a: ReturnType<typeof intentAlignment>) =>
  `${a.label} (${Math.round(a.score * 100)}%): ${a.heading || "no title"}`;

const comparisonText = (p: ParsedPage) =>
  `${signalLabels(comparisonKeys(p))}${answersWhichToChoose(p) ? "; says which to choose" : ""}`;

function intentRow({ page, mine, input }: RowContext): DimensionRow {
  const cited = intentAlignment(input.prompt, page);
  const yours = mine ? intentAlignment(input.prompt, mine) : null;
  return row(
    "intent",
    intentText(cited),
    yours ? intentText(yours) : NO_OWNER,
    yours ? compare(cited.score, yours.score, 0.15) : "not_comparable",
  );
}

function entitiesRow({ page, mine, input }: RowContext): DimensionRow {
  const cited = entitiesOn(page, input.vocabulary);
  const yours = mine ? entitiesOn(mine, input.vocabulary) : null;
  const text = (e: string[]) =>
    `${e.length} named: ${listOrNone(e.slice(0, 8))}`;
  return row(
    "entities",
    text(cited),
    yours ? text(yours) : NO_OWNER,
    yours ? compare(cited.length, yours.length, 1) : "not_comparable",
  );
}

function commercialRow({ page, mine }: RowContext): DimensionRow {
  const cited = commercialKeys(page);
  const yours = mine ? commercialKeys(mine) : null;
  return row(
    "commercial",
    factLabels(cited),
    yours ? factLabels(yours) : NO_OWNER,
    yours ? compare(cited.length, yours.length) : "not_comparable",
  );
}

function comparisonRow({ page, mine }: RowContext): DimensionRow {
  return row(
    "comparison",
    comparisonText(page),
    mine ? comparisonText(mine) : NO_OWNER,
    mine
      ? compare(comparisonKeys(page).length, comparisonKeys(mine).length)
      : "not_comparable",
  );
}

const levelText = (level: string, p: ParsedPage) =>
  `${level}${p.methodology ? ", method stated" : ""}`;

function firstHandRow({ source, page, mine }: RowContext): DimensionRow {
  const cited = firstHandLevel(page, source.sourceType);
  const yours = mine ? firstHandLevel(mine, "own") : null;
  return row(
    "firstHand",
    levelText(cited, page),
    mine && yours ? levelText(yours, mine) : NO_OWNER,
    yours
      ? compare(FIRST_HAND_RANK[cited], FIRST_HAND_RANK[yours])
      : "not_comparable",
  );
}

function expertRow({ page, mine }: RowContext): DimensionRow {
  return row(
    "expert",
    authorText(page),
    mine ? authorText(mine) : NO_OWNER,
    mine
      ? compare(expertSignalCount(page), expertSignalCount(mine))
      : "not_comparable",
  );
}

function tablesRow({ page, mine }: RowContext): DimensionRow {
  return row(
    "tables",
    tableText(page),
    mine ? tableText(mine) : NO_OWNER,
    mine
      ? compare(structuredTableCount(page), structuredTableCount(mine))
      : "not_comparable",
  );
}

function recencyVerdict(
  cited: string | null,
  yours: string | null,
): DimensionVerdict {
  if (cited && !yours) return "cited_stronger";
  if (!cited && yours) return "yours_stronger";
  if (!cited || !yours) return "not_measured";
  const diff = Date.parse(cited) - Date.parse(yours);
  if (diff > DATE_GAP_DAYS * DAY_MS) return "cited_stronger";
  if (diff < -DATE_GAP_DAYS * DAY_MS) return "yours_stronger";
  return "similar";
}

function recencyRow({ page, mine, input }: RowContext): DimensionRow {
  return row(
    "recency",
    datedText(page, input.now),
    mine ? datedText(mine, input.now) : NO_OWNER,
    mine ? recencyVerdict(pageDate(page), pageDate(mine)) : "not_comparable",
  );
}

function corroborationRow({ source }: RowContext): DimensionRow {
  const own = source.ownOnPage;
  let verdict: DimensionVerdict = "not_comparable";
  let text = "The competitor's own page, so not independent";
  if (isThirdParty(source.sourceType)) {
    text = `Independent page; names ${source.brandsOnPage.length} tracked competitor(s)${own ? " and you" : ", not you"}`;
    if (own) verdict = "similar";
    else
      verdict =
        source.brandsOnPage.length > 0 ? "cited_stronger" : "not_measured";
  }
  return row(
    "corroboration",
    text,
    own ? "Named on this page" : "Not named on this page",
    verdict,
  );
}

function countRow(
  dimension: GapDimensionKey,
  cited: number,
  yours: number | null,
  noun: string,
): DimensionRow {
  return row(
    dimension,
    `${cited} ${noun}`,
    yours === null ? NO_OWNER : `${yours} ${noun}`,
    "not_comparable",
  );
}

function rowsFor(
  source: CitedSourceSummary,
  page: ParsedPage,
  input: DiffInput,
): DimensionRow[] {
  const ctx: RowContext = { source, page, mine: input.owner, input };
  const { mine } = ctx;
  return [
    intentRow(ctx),
    entitiesRow(ctx),
    commercialRow(ctx),
    comparisonRow(ctx),
    firstHandRow(ctx),
    expertRow(ctx),
    tablesRow(ctx),
    countRow(
      "evidenceLinks",
      page.externalLinks.length,
      mine ? mine.externalLinks.length : null,
      "outbound links",
    ),
    recencyRow(ctx),
    countRow(
      "internalLinks",
      page.internalLinkCount,
      mine ? mine.internalLinkCount : null,
      "internal links on the page",
    ),
    corroborationRow(ctx),
    row("authority", "Not measured", "Not measured", "not_measured"),
  ];
}

export function buildDifferences(input: DiffInput): SourceDifference[] {
  return readableCompetitors(input.sources).map((source) => ({
    url: source.url,
    rows: rowsFor(source, source.snapshot!.page!, input),
  }));
}

type PatternDef = {
  key: string;
  dimension: GapDimensionKey;
  label: string;
  test: (
    page: ParsedPage,
    source: CitedSourceSummary,
    input: DiffInput,
  ) => boolean;
  yours: (page: ParsedPage, input: DiffInput) => boolean;
};

const hasPrice = (p: ParsedPage) => !!p.commercial.price;
const hasModel = (p: ParsedPage) =>
  !!(p.commercial.noSubscription || p.commercial.payAsYouGo);
const datedRecently = (p: ParsedPage, now: Date) => {
  const age = ageDays(pageDate(p), now);
  return age !== null && age <= YEAR_DAYS;
};

const PATTERNS: PatternDef[] = [
  {
    key: "explicit_price",
    dimension: "commercial",
    label: "state a price",
    test: (p) => hasPrice(p),
    yours: (p) => hasPrice(p),
  },
  {
    key: "billing_model",
    dimension: "commercial",
    label: "say whether it is subscription or pay as you go",
    test: (p) => hasModel(p),
    yours: (p) => hasModel(p),
  },
  {
    key: "comparison_structure",
    dimension: "comparison",
    label:
      "have comparison structure (table, alternatives, verdict, best-for or pros and cons)",
    test: (p) => hasComparisonStructure(p),
    yours: (p) => hasComparisonStructure(p),
  },
  {
    key: "which_to_choose",
    dimension: "comparison",
    label: "say which option to choose (verdict or best-for)",
    test: (p) => answersWhichToChoose(p),
    yours: (p) => answersWhichToChoose(p),
  },
  {
    key: "structured_table",
    dimension: "tables",
    label: "put facts in a pricing, comparison or feature table",
    test: (p) => structuredTableCount(p) > 0,
    yours: (p) => structuredTableCount(p) > 0,
  },
  {
    key: "intent_in_heading",
    dimension: "intent",
    label: "put the prompt's topic words in the title or H1",
    test: (p, _s, i) => intentAlignment(i.prompt, p).score >= 0.6,
    yours: (p, i) => intentAlignment(i.prompt, p).score >= 0.6,
  },
  {
    key: "recent_date",
    dimension: "recency",
    label: "show a date within the last 12 months",
    test: (p, _s, i) => datedRecently(p, i.now),
    yours: (p, i) => datedRecently(p, i.now),
  },
  {
    key: "first_hand",
    dimension: "firstHand",
    label: "show signs of testing (method, benchmark or samples)",
    test: (p, s) => FIRST_HAND_RANK[firstHandLevel(p, s.sourceType)] >= 2,
    yours: (p) => FIRST_HAND_RANK[firstHandLevel(p, "own")] >= 2,
  },
  {
    key: "named_author",
    dimension: "expert",
    label: "show a named author or reviewer",
    test: (p) => !!(p.author || p.reviewer),
    yours: (p) => !!(p.author || p.reviewer),
  },
  {
    key: "names_competitors",
    dimension: "entities",
    label: "name two or more tracked brands",
    test: (_p, s) => s.brandsOnPage.length >= 2,
    yours: (p, i) => entitiesOn(p, i.competitorNames).length >= 2,
  },
];

/** What cited pages have in common, counted over the pages that were read. */
export function buildConsensus(input: DiffInput): ConsensusPattern[] {
  const readable = readableCompetitors(input.sources);
  if (readable.length === 0) return [];
  return PATTERNS.map((def) => {
    const hits = readable.filter((s) => def.test(s.snapshot!.page!, s, input));
    return {
      key: def.key,
      dimension: def.dimension,
      label: def.label,
      citedCount: hits.length,
      readable: readable.length,
      yours: input.owner ? def.yours(input.owner, input) : null,
      urls: hits.map((s) => s.url),
    };
  });
}

/** A pattern most of the readable pages share, and at least two do. */
export function isRecurring(p: ConsensusPattern): boolean {
  return p.citedCount >= 2 && p.citedCount / p.readable >= RECURRING_SHARE;
}

/** Entities most readable pages name that the owner page does not. */
export function missingEntities(input: DiffInput): {
  entity: string;
  count: number;
  readable: number;
  urls: string[];
}[] {
  if (!input.owner) return [];
  const readable = readableCompetitors(input.sources);
  const mine = new Set(entitiesOn(input.owner, input.vocabulary));
  const counts = new Map<string, string[]>();
  for (const source of readable)
    for (const entity of entitiesOn(source.snapshot!.page!, input.vocabulary))
      if (!mine.has(entity) && !input.ownBrandNames.includes(entity))
        counts.set(entity, [...(counts.get(entity) ?? []), source.url]);
  const recurring = [...counts]
    .map(([entity, urls]) => ({
      entity,
      count: urls.length,
      readable: readable.length,
      urls,
    }))
    .filter((e) => e.count >= 2 && e.count / e.readable >= RECURRING_SHARE);
  recurring.sort(
    (a, b) => b.count - a.count || a.entity.localeCompare(b.entity),
  );
  return recurring.slice(0, 6);
}
