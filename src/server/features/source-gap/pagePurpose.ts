import type { ParsedPage } from "@/shared/source-gap";

/** "Name: what it is good at" headings, the usual shape of one section per product. */
const NAMED_SECTION = /^([A-Z][A-Za-z0-9.+&' -]{1,28}):\s+\S/;
/** "Step 2: ..." and "Note: ..." are not products. */
const NOT_A_PRODUCT = /^(step|note|tip|warning|example|question|answer)\b/i;
const HOW_TO_TITLE = /\bhow to\b|^how (do|can) (i|you|we)\b/i;
const HOW_TO_STEP = /^(step\s+\d+|\d+[.)]\s)|\bhow (do|to|can)\b/i;

type PagePurpose = "comparison" | "product" | "how_to" | "unknown";

interface PageContent {
  purpose: PagePurpose;
  /** Distinct options the page sets side by side: product sections, or the larger side of a comparison table. */
  optionsCompared: number;
  /** Ways the page helps a reader choose: a table, a verdict, best-for guidance, pros and cons, an alternatives list. */
  choosingAids: number;
}

function headingsOf(page: ParsedPage): string[] {
  return [...page.h2s, ...page.h3s];
}

function namedSections(page: ParsedPage): number {
  const names = new Set<string>();
  for (const heading of headingsOf(page)) {
    const name = NAMED_SECTION.exec(heading.trim())?.[1];
    if (name && !NOT_A_PRODUCT.test(name)) names.add(name.toLowerCase());
  }
  return names.size;
}

/** A first column that lists products, rather than the features being compared. */
const PRODUCT_ROWS =
  /^(tool|product|app|software|service|provider|company|brand|option|name|vendor)s?\b/i;

/**
 * Products set side by side in a table: its rows, when the first column names
 * products. A table of features or prices has rows that are not products, and
 * the extractor mixes row labels into its headers, so column counts are not used.
 */
function tableOptions(page: ParsedPage): number {
  return (
    page.tables
      .filter((t) => PRODUCT_ROWS.test(t.headers[0] ?? ""))
      // The row count includes the header row.
      .reduce((most, t) => Math.max(most, t.rows - 1), 0)
  );
}

function choosingAids(page: ParsedPage): number {
  const c = page.comparison;
  return [
    c.comparisonTable || c.featureMatrix || c.pricingTable,
    c.verdict,
    c.bestFor,
    c.prosCons,
    c.alternativesList,
  ].filter(Boolean).length;
}

/**
 * What a read page does, from its body: how many products it sets side by
 * side and whether it helps a reader choose between them. A title that says
 * "best" does not make a page a comparison, and a page that compares several
 * products is one whatever its title says.
 */
export function readPageContent(page: ParsedPage): PageContent {
  const optionsCompared = Math.max(namedSections(page), tableOptions(page));
  const aids = choosingAids(page);
  const steps = headingsOf(page).filter((h) => HOW_TO_STEP.test(h)).length;
  const teaches = HOW_TO_TITLE.test(page.h1s[0] ?? page.title ?? "");
  const sellsOneThing =
    page.schemaTypes.some((t) => /^(Product|SoftwareApplication)$/.test(t)) ||
    page.pageKind === "product";

  let purpose: PagePurpose = "unknown";
  if (optionsCompared >= 3 && aids >= 1) purpose = "comparison";
  else if ((steps >= 3 || teaches) && optionsCompared < 3) purpose = "how_to";
  else if (optionsCompared <= 2 && sellsOneThing) purpose = "product";
  return { purpose, optionsCompared, choosingAids: aids };
}
