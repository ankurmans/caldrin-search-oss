import {
  engineLabel,
  type SourceSortField,
  type SourceView,
} from "@/types/schemas/source-intelligence";
import { classifySource, type SourceClass } from "./sourceClass";

/** One count of answers for a page or domain on one engine. */
export type CountRow = {
  key: string;
  domain: string;
  engine: string;
  answers: number;
  title: string | null;
  description: string | null;
  lastSeen: string | null;
};

export type Brand = { domain: string; name: string; own: boolean };

// How a page reached the answers the provider reported.
export type SourceRelation =
  // Listed as retrieved and cited as a source.
  | "retrieved_and_cited"
  // Listed as retrieved, never cited in these answers.
  | "retrieved_only"
  // Cited, with no retrieval record for it. Either the engine hides its
  // retrieval list or the provider did not list this page.
  | "cited_only";

export type SourceRow = {
  key: string;
  domain: string;
  title: string | null;
  description: string | null;
  retrievedAnswers: number;
  citedAnswers: number;
  // Answers on all engines. Not the sum of the two counts: one answer can both
  // retrieve and cite the same page.
  engines: string[];
  lastSeen: string | null;
  relation: SourceRelation;
  brand: "own" | "competitor" | null;
  /** From the host and title; "unknown" when no rule covers it. */
  sourceClass: SourceClass;
};

/** A source host belongs to a brand when it is that domain or a subdomain. */
function brandOf(host: string, brands: Brand[]): "own" | "competitor" | null {
  const h = host.toLowerCase().replace(/^www\./, "");
  const match = brands.find((b) => {
    const d = b.domain.toLowerCase().replace(/^www\./, "");
    return h === d || h.endsWith(`.${d}`);
  });
  if (!match) return null;
  return match.own ? "own" : "competitor";
}

function laterOf(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Joins the cited and retrieved counts of each page or domain. The answer
 * counts are per engine, so an engine total can be added without counting an
 * answer twice; the two counts are never combined.
 */
export function mergeCounts(
  cited: CountRow[],
  retrieved: CountRow[],
  brands: Brand[],
): SourceRow[] {
  const rows = new Map<string, SourceRow>();
  const get = (row: CountRow) => {
    let existing = rows.get(row.key);
    if (!existing) {
      existing = {
        key: row.key,
        domain: row.domain,
        title: null,
        description: null,
        retrievedAnswers: 0,
        citedAnswers: 0,
        engines: [],
        lastSeen: null,
        relation: "cited_only",
        brand: brandOf(row.domain, brands),
        sourceClass: "unknown",
      };
      rows.set(row.key, existing);
    }
    return existing;
  };
  const apply = (row: CountRow, kind: "cited" | "retrieved") => {
    const out = get(row);
    if (kind === "cited") out.citedAnswers += row.answers;
    else out.retrievedAnswers += row.answers;
    out.title ??= row.title;
    out.description ??= row.description;
    if (!out.engines.includes(row.engine)) out.engines.push(row.engine);
    out.lastSeen = laterOf(out.lastSeen, row.lastSeen);
  };
  for (const row of cited) apply(row, "cited");
  for (const row of retrieved) apply(row, "retrieved");
  for (const row of rows.values()) {
    row.engines.sort();
    row.sourceClass = classifySource({
      host: row.domain,
      title: row.title,
      brand: row.brand,
    });
    row.relation =
      row.retrievedAnswers > 0 && row.citedAnswers > 0
        ? "retrieved_and_cited"
        : row.retrievedAnswers > 0
          ? "retrieved_only"
          : "cited_only";
  }
  return [...rows.values()];
}

export type QueryRow = {
  query: string;
  answers: number;
  prompts: number;
  engines: string[];
  lastSeen: string | null;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  metricsFetchedAt: string | null;
};

const SORTS: Record<
  SourceSortField,
  (row: SourceRow | QueryRow) => number | string
> = {
  retrieved: (r) => ("retrievedAnswers" in r ? r.retrievedAnswers : 0),
  cited: (r) => ("citedAnswers" in r ? r.citedAnswers : 0),
  answers: (r) => ("answers" in r ? r.answers : 0),
  lastSeen: (r) => r.lastSeen ?? "",
  name: (r) => ("query" in r ? r.query : r.key),
};

/** Sorts, then slices one page. Ties fall back to the name so pages are stable. */
export function pageOf<T extends SourceRow | QueryRow>(
  rows: T[],
  options: {
    view: SourceView;
    sortBy: SourceSortField;
    sortDir: "asc" | "desc";
    page: number;
    pageSize: number;
  },
) {
  const sign = options.sortDir === "asc" ? 1 : -1;
  const value = SORTS[options.sortBy];
  const name = SORTS.name;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x < y) return -sign;
    if (x > y) return sign;
    return String(name(a)).localeCompare(String(name(b)));
  });
  const start = (options.page - 1) * options.pageSize;
  return {
    total: rows.length,
    rows: sorted.slice(start, start + options.pageSize),
  };
}

export type EngineCoverage = {
  engine: string;
  answers: number;
  queriesExposed: number;
  retrievalExposed: number;
  withCitations: number;
  // Answers saved before these fields were read: neither exposed nor absent.
  notCaptured: number;
};

/** What each engine's answers let us say, in words a reader can check. */
export function coverageNotes(coverage: EngineCoverage[]): string[] {
  const notes: string[] = [];
  for (const c of coverage) {
    if (c.answers === 0) continue;
    if (c.notCaptured > 0)
      notes.push(
        `${c.notCaptured} of ${c.answers} ${engineLabel(c.engine)} answers were saved before searches and retrieved pages were read. They show cited pages only and are not counted as having none.`,
      );
    const captured = c.answers - c.notCaptured;
    if (captured > 0 && c.queriesExposed === 0)
      notes.push(
        `The provider reports no search queries for ${engineLabel(c.engine)}. Nothing is inferred about what it searched.`,
      );
    if (captured > 0 && c.retrievalExposed === 0)
      notes.push(
        `The provider lists no retrieved pages for ${engineLabel(c.engine)}. Retrieval and citation cannot be compared for it.`,
      );
  }
  return notes;
}
