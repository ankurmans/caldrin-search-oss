import { groupByProp, sort, unique } from "remeda";
import type { AiEngine } from "@/shared/ai-visibility";
import type { AiMeasurementRepository } from "../repositories/aiMeasurementRepository";
import type { RunRow } from "../repositories/AiVisibilityRepository";
import {
  TOP_LIST_SIZE,
  type CitedItem,
  type Measurement,
  type SideMeasurement,
} from "./aiMeasurementTypes";
import { repeatRunLevel, repeatRunNote, toRate } from "./aiMeasurementStats";

type Facts = Awaited<ReturnType<typeof AiMeasurementRepository.getAnswerFacts>>;
type Competitors = Awaited<
  ReturnType<typeof AiMeasurementRepository.getCompetitorMatches>
>;
type CitedSources = Awaited<
  ReturnType<typeof AiMeasurementRepository.getCitedSources>
>;

export interface SideData {
  runs: RunRow[];
  facts: Facts;
  competitors: Competitors;
  sources: CitedSources;
}

function topCited(
  rows: { engine: string; key: string; answers: number }[],
  engine: AiEngine | "all",
  answered: number,
): CitedItem[] {
  const totals = new Map<string, number>();
  for (const row of rows)
    if (engine === "all" || row.engine === engine)
      totals.set(row.key, (totals.get(row.key) ?? 0) + row.answers);
  return sort(
    [...totals].map(([key, answers]) => ({
      key,
      answers,
      share: answered > 0 ? answers / answered : null,
    })),
    (a, b) => b.answers - a.answers || a.key.localeCompare(b.key),
  ).slice(0, TOP_LIST_SIZE);
}

function measure(
  engine: AiEngine | "all",
  allFacts: Facts,
  data: SideData,
): Measurement {
  const facts =
    engine === "all" ? allFacts : allFacts.filter((f) => f.engine === engine);
  const answered = facts.filter(
    (f) => f.status === "completed" && f.hasAnswer === 1,
  );
  const failed = facts.filter((f) => f.status === "failed").length;
  const pending = facts.filter((f) => f.status === "pending").length;
  const noAnswer = facts.filter(
    (f) => f.status === "completed" && f.hasAnswer === 0,
  ).length;
  // A completed answer always has an own-brand result; one without is not counted.
  const measurable = answered.filter((f) => f.mentioned !== null);
  const verdicts = measurable.filter((f) => f.recommended !== null);

  const byPrompt = groupByProp(measurable, "promptId");
  const citedPrompts = Object.values(byPrompt).filter((rows) =>
    rows.some((f) => f.cited),
  );
  const inPool = citedPrompts.flat();

  const answeredIds = new Set(answered.map((f) => f.observationId));
  const competitorRows = groupByProp(
    data.competitors.filter((c) => answeredIds.has(c.observationId)),
    "domain",
  );

  return {
    engine,
    counts: {
      planned: facts.length,
      answered: answered.length,
      noAnswer,
      failed,
      pending,
      excluded: noAnswer + failed + pending,
    },
    models: sort(unique(facts.flatMap((f) => f.model ?? [])), (a, b) =>
      a.localeCompare(b),
    ),
    mention: toRate(
      measurable.filter((f) => f.mentioned).length,
      measurable.length,
    ),
    ownCitation: toRate(
      measurable.filter((f) => f.cited).length,
      measurable.length,
    ),
    recommendation: {
      ...toRate(verdicts.filter((f) => f.recommended).length, verdicts.length),
      detection: "explicit_language_heuristic",
    },
    pool: {
      prompts: Object.keys(byPrompt).length,
      promptsCited: citedPrompts.length,
      selection: toRate(inPool.filter((f) => f.cited).length, inPool.length),
    },
    competitors: sort(
      Object.entries(competitorRows).map(([domain, rows]) => ({
        name: rows.find((r) => r.name)?.name ?? domain,
        domain,
        mention: toRate(rows.filter((r) => r.mentioned).length, rows.length),
        citation: toRate(rows.filter((r) => r.cited).length, rows.length),
      })),
      (a, b) =>
        b.mention.numerator - a.mention.numerator ||
        a.domain.localeCompare(b.domain),
    ),
    topCitedDomains: topCited(data.sources.domains, engine, measurable.length),
    topCitedUrls: topCited(data.sources.urls, engine, measurable.length),
  };
}

export function summarizeSide(data: SideData): SideMeasurement {
  const { runs, facts } = data;
  const engines = sort(unique(facts.map((f) => f.engine)), (a, b) =>
    a.localeCompare(b),
  );
  const contributing = new Set(
    facts
      .filter((f) => f.status === "completed" && f.hasAnswer === 1)
      .map((f) => f.runId),
  ).size;
  const level = repeatRunLevel(contributing);
  const ends = runs.map((r) => r.completedAt ?? r.createdAt);
  return {
    runCount: runs.length,
    runIds: runs.map((r) => r.id),
    contributingRuns: contributing,
    unfinishedRuns: runs.filter(
      (r) => r.status === "queued" || r.status === "running",
    ).length,
    observedWindow: runs.length
      ? {
          start: runs[0].createdAt,
          end: sort(ends, (a, b) => b.localeCompare(a))[0],
        }
      : null,
    promptSetVersionIds: sort(
      unique(runs.map((r) => r.promptSetVersionId)),
      (a, b) => (a ?? "").localeCompare(b ?? ""),
    ),
    engines,
    markets: sort(
      unique(runs.map((r) => `${r.locationCode}:${r.languageCode}`)),
      (a, b) => a.localeCompare(b),
    ),
    ownBrands: sort(
      unique(
        facts.flatMap((f) =>
          f.ownDomain ? `${f.ownName}|${f.ownDomain}` : [],
        ),
      ),
      (a, b) => a.localeCompare(b),
    ),
    repeatRuns: {
      runCount: contributing,
      level,
      minForAnalysis: 10,
      minForClientNumber: 30,
      note: repeatRunNote(level),
    },
    overall: measure("all", facts, data),
    byEngine: engines.map((engine) => measure(engine, facts, data)),
  };
}
