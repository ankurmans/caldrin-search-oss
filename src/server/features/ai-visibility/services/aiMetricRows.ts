import { AiMeasurementRepository as measurementRepo } from "../repositories/aiMeasurementRepository";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { aiMarketQuery } from "@/shared/ai-market";
import type { AiMetricRowsInput } from "@/types/schemas/ai-visibility";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RUNS = 200;
const MAX_ROWS = 50_000;

const COLUMNS = [
  "date",
  "run_id",
  "location_code",
  "language_code",
  "topic",
  "prompt",
  "branded",
  "engine",
  "answered",
  "brand_mentioned",
  "brand_cited",
  "brand_recommended",
  "competitors_mentioned",
] as const;

function csvCell(value: string | number | boolean | null | undefined) {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * One row per collected answer in the window, without the answer text, for
 * spreadsheets and business-intelligence tools. `answered` says whether the
 * engine gave an answer; the three brand columns are empty when it did not,
 * which is not the same as false.
 */
export async function loadAiMetricRows(input: AiMetricRowsInput) {
  const end = new Date();
  const runs = await measurementRepo.listFinishedRunsInWindow(
    input.projectId,
    {
      start: new Date(end.getTime() - input.days * DAY_MS).toISOString(),
      end: end.toISOString(),
    },
    MAX_RUNS + 1,
    aiMarketQuery(input),
  );
  const runsTruncated = runs.length > MAX_RUNS;
  const kept = runs.slice(0, MAX_RUNS);
  const runIds = kept.map((run) => run.id);
  const [facts, competitors, config] = await Promise.all([
    measurementRepo.getAnswerFacts(runIds),
    measurementRepo.getCompetitorMatches(runIds),
    repo.getConfiguration(input.projectId),
  ]);
  const prompts = new Map((config?.prompts ?? []).map((p) => [p.id, p]));
  const runById = new Map(kept.map((run) => [run.id, run]));
  const rivals = new Map<string, number>();
  for (const match of competitors)
    if (match.mentioned)
      rivals.set(
        match.observationId,
        (rivals.get(match.observationId) ?? 0) + 1,
      );

  const rowsTruncated = facts.length > MAX_ROWS;
  const rows = facts.slice(0, MAX_ROWS).map((fact) => {
    const run = runById.get(fact.runId);
    const prompt = prompts.get(fact.promptId);
    const answered = fact.status === "completed" && fact.hasAnswer === 1;
    return [
      (fact.collectedAt ?? run?.createdAt ?? "").slice(0, 10),
      fact.runId,
      run?.locationCode,
      run?.languageCode,
      prompt?.topic,
      prompt?.text,
      fact.branded,
      fact.engine,
      answered,
      answered ? Boolean(fact.mentioned) : null,
      answered ? Boolean(fact.cited) : null,
      answered ? fact.recommended : null,
      answered ? (rivals.get(fact.observationId) ?? 0) : null,
    ];
  });
  return {
    csv: [COLUMNS.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join(
      "\r\n",
    ),
    rowCount: rows.length,
    truncated: runsTruncated || rowsTruncated,
  };
}
