import { sort, unique } from "remeda";
import type {
  CitationSourceKind,
  CitationSourceRow,
} from "@/shared/citation-gaps";
import {
  groupInto,
  isAnswered,
  type IntelFact,
} from "@/server/features/ai-visibility/services/aiVisibilityIntelligenceMetrics";

/** One cited page of one answer, as stored. */
export interface CitedSource {
  observationId: string;
  url: string;
  domain: string;
  title: string | null;
  /** Place in the engine's list of cited pages; absent in older callers. */
  position?: number;
}

/** "WWW.Example.com." → "example.com", so one site is one row. */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

/** A page on the domain or any subdomain of it. */
export function isOnDomain(host: string, domain: string): boolean {
  const h = normalizeDomain(host);
  const d = normalizeDomain(domain);
  return !!d && (h === d || h.endsWith(`.${d}`));
}

/** Whose site a cited domain is: yours, a tracked competitor's, or neither. */
export function sourceKind(
  domain: string,
  brands: { domain: string; name: string; own: boolean }[],
): { kind: CitationSourceKind; brandName: string | null } {
  const own = brands.find((b) => b.own && isOnDomain(domain, b.domain));
  if (own) return { kind: "own", brandName: own.name };
  const rival = brands.find((b) => !b.own && isOnDomain(domain, b.domain));
  if (rival) return { kind: "competitor", brandName: rival.name };
  return { kind: "third_party", brandName: null };
}

/** Each answered collection's cited pages, one entry per distinct URL. */
export function sourcesByAnswer(
  facts: IntelFact[],
  sources: CitedSource[],
): Map<string, CitedSource[]> {
  const answered = new Set(facts.filter(isAnswered).map((f) => f.id));
  const byAnswer = new Map<string, CitedSource[]>();
  for (const source of sources) {
    if (!answered.has(source.observationId)) continue;
    const list = byAnswer.get(source.observationId) ?? [];
    if (!list.some((s) => s.url === source.url))
      list.push({ ...source, domain: normalizeDomain(source.domain) });
    byAnswer.set(source.observationId, list);
  }
  return byAnswer;
}

/**
 * Every cited domain across the answered facts, with how often and where it
 * was cited and which tracked brands the citing answers named. A citation is
 * only that: the cited page is not assumed to endorse any brand in the answer.
 */
export function buildSourceRows(
  facts: IntelFact[],
  sources: CitedSource[],
): CitationSourceRow[] {
  const answered = facts.filter(isAnswered);
  const factById = new Map(answered.map((f) => [f.id, f]));
  const brands = unique(
    answered.flatMap((f) =>
      f.brands.map((b) => `${b.domain}\u0000${b.name}\u0000${b.own ? 1 : 0}`),
    ),
  ).map((key) => {
    const [domain, name, own] = key.split("\u0000");
    return { domain, name: name || domain, own: own === "1" };
  });
  const cited = [...sourcesByAnswer(facts, sources)].flatMap(([id, list]) =>
    list.map((source) => ({ source, fact: factById.get(id)! })),
  );
  const rows = [...groupInto(cited, (c) => c.source.domain)].map(
    ([domain, entries]): CitationSourceRow => {
      const answerFacts = [
        ...new Map(entries.map((e) => [e.fact.id, e.fact])).values(),
      ];
      const urls = [...groupInto(entries, (e) => e.source.url)].map(
        ([url, hits]) => ({
          url,
          title: hits.find((h) => h.source.title)?.source.title ?? null,
          answers: new Set(hits.map((h) => h.fact.id)).size,
        }),
      );
      const named = answerFacts.flatMap((f) =>
        f.brands.filter((b) => b.mentioned),
      );
      const dates = sort(
        answerFacts.flatMap((f) => f.collectedAt ?? []),
        (a, b) => a.localeCompare(b),
      );
      return {
        domain,
        ...sourceKind(domain, brands),
        urls: sort(
          urls,
          (a, b) => b.answers - a.answers || a.url.localeCompare(b.url),
        ),
        answers: answerFacts.length,
        prompts: new Set(answerFacts.map((f) => f.promptId)).size,
        promptGroups: sort(unique(answerFacts.map((f) => f.topic)), (a, b) =>
          a.localeCompare(b),
        ),
        engines: [...groupInto(answerFacts, (f) => f.engine)].map(
          ([engine, list]) => ({ engine, answers: list.length }),
        ),
        brandsNamed: sort(
          [...groupInto(named, (b) => b.domain)].map(([d, list]) => ({
            domain: d,
            name: list[0].name || d,
            own: list[0].own,
            answers: list.length,
          })),
          (a, b) => b.answers - a.answers || a.name.localeCompare(b.name),
        ),
        ownNamedAnswers: answerFacts.filter((f) =>
          f.brands.some((b) => b.own && b.mentioned),
        ).length,
        firstSeen: dates[0] ?? null,
        lastSeen: dates.at(-1) ?? null,
      };
    },
  );
  return sort(
    rows,
    (a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain),
  );
}

const MAX_PASSAGE = 400;

/**
 * The saved answer's own lines that link to or name one of the cited pages,
 * turned into plain text. Nothing is fetched or paraphrased: when the answer
 * lists the source without using it inline, there is no passage.
 */
export function citedPassages(
  markdown: string,
  urls: string[],
  domain: string,
  toText: (markdown: string) => string,
): string[] {
  const host = normalizeDomain(domain);
  const out: string[] = [];
  for (const paragraph of markdown.split(
    /\n{2,}|\n(?=\s*(?:[-*+]|\d+\\?\.)\s)/,
  )) {
    const lower = paragraph.toLowerCase();
    if (!urls.some((u) => paragraph.includes(u)) && !lower.includes(host))
      continue;
    const text = toText(paragraph).replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push(
      text.length > MAX_PASSAGE ? `${text.slice(0, MAX_PASSAGE - 1)}…` : text,
    );
  }
  return unique(out).slice(0, 3);
}
