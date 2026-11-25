import { aiMarketQuery } from "@/shared/ai-market";
import { reverse, sort, unique } from "remeda";
import type { AiEngine } from "@/shared/ai-visibility";
import type {
  AiVisibilityIntelligence,
  IntelBrand,
} from "@/shared/ai-visibility-intelligence";
import type { AiIntelligenceInput } from "@/types/schemas/ai-visibility-intelligence";
import { AiIntelligenceRepository } from "../repositories/aiIntelligenceRepository";
import { AiMeasurementRepository as measurementRepo } from "../repositories/aiMeasurementRepository";
import { AiPromptSetVersionRepository as versionRepo } from "../repositories/aiPromptSetVersionRepository";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import {
  metricChange,
  repeatRunLevel,
  repeatRunNote,
  weakerLevel,
} from "./aiMeasurementStats";
import {
  brandVisibility,
  collectionTrend,
  computeBrands,
  groupInto,
  intelCoverage,
  isAnswered,
  type IntelFact,
} from "./aiVisibilityIntelligenceMetrics";

export const DAY_MS = 86_400_000;
// Every fact of these runs is read into memory, so the window stays capped
// (a daily tracker over 90 days fits). Reads are sliced under the bind limit.
export const MAX_RUNS = 120;

type Run = Awaited<ReturnType<typeof measurementRepo.listFinishedRuns>>[number];

export function applyFilters(facts: IntelFact[], input: AiIntelligenceInput) {
  return facts.filter(
    (f) =>
      (!input.engines || input.engines.includes(f.engine)) &&
      (!input.topic || f.topic === input.topic) &&
      (!input.intents || input.intents.includes(f.intent ?? "unknown")) &&
      (input.branded === "all" ||
        (input.branded === "branded" ? f.branded : !f.branded)),
  );
}

/** Change against the previous window of equal length, only when comparable. */
async function compareWithPrevious(
  input: AiIntelligenceInput,
  window: { start: string; end: string },
  versionId: string | null,
  current: { brands: IntelBrand[]; engines: AiEngine[]; runs: number },
): Promise<{ comparable: boolean; reason: string | null }> {
  const runs = (
    await measurementRepo.listFinishedRuns(
      input.projectId,
      { from: window.start, to: window.end },
      MAX_RUNS,
      aiMarketQuery(input),
    )
  ).filter((r) => r.promptSetVersionId === versionId);
  if (!runs.length)
    return {
      comparable: false,
      reason:
        "The previous period has no runs of this prompt set, so no change is shown.",
    };
  const facts = applyFilters(
    await AiIntelligenceRepository.getFacts(runs.map((r) => r.id)),
    input,
  );
  const coverage = intelCoverage(facts);
  if (coverage.engines.join() !== current.engines.join())
    return {
      comparable: false,
      reason: `The previous period answered on ${coverage.engines.length} engine(s) and this one on ${current.engines.length}, so their figures are not compared.`,
    };
  const previous = computeBrands(facts, input.competitors ?? null);
  const level = weakerLevel(
    repeatRunLevel(coverage.contributingRuns),
    repeatRunLevel(current.runs),
  );
  for (const brand of current.brands) {
    const before = previous.find((b) => b.domain === brand.domain);
    if (!before) continue;
    brand.change = {
      previousVisibility: before.visibility,
      difference:
        before.visibility !== null && brand.visibility !== null
          ? brand.visibility - before.visibility
          : null,
      verdict: metricChange(before.mention, brand.mention, level).verdict,
    };
  }
  return { comparable: true, reason: null };
}

function versionsOf(
  runs: Run[],
  labels: Map<string, number>,
  selected: string | null,
) {
  return [...groupInto(runs, (r) => r.promptSetVersionId ?? "none")].map(
    ([key, group]) => {
      const id = key === "none" ? null : key;
      return {
        id,
        version: id ? (labels.get(id) ?? null) : null,
        runs: group.length,
        selected: id === selected,
      };
    },
  );
}

/**
 * The window's newest finished runs and the prompt set measured: the one
 * asked for when it ran in the window, else the newest run's. Every read of
 * the page uses this, so figures and evidence count the same runs.
 */
export async function selectIntelRuns(
  input: Pick<
    AiIntelligenceInput,
    | "projectId"
    | "days"
    | "promptSetVersionId"
    | "locationCode"
    | "languageCode"
  >,
) {
  const end = new Date();
  const start = new Date(end.getTime() - input.days * DAY_MS);
  const window = { start: start.toISOString(), end: end.toISOString() };
  const found = await measurementRepo.listFinishedRuns(
    input.projectId,
    { from: window.start, to: window.end },
    MAX_RUNS + 1,
    aiMarketQuery(input),
  );
  const runs = found.slice(0, MAX_RUNS);
  const known = new Set(runs.map((r) => r.promptSetVersionId));
  const selectedVersionId =
    input.promptSetVersionId && known.has(input.promptSetVersionId)
      ? input.promptSetVersionId
      : (runs[0]?.promptSetVersionId ?? null);
  return {
    window,
    runs,
    truncated: found.length > MAX_RUNS,
    selectedVersionId,
    selectedRuns: runs.filter(
      (r) => r.promptSetVersionId === selectedVersionId,
    ),
  };
}

export async function loadAiIntelligence(
  input: AiIntelligenceInput,
): Promise<AiVisibilityIntelligence> {
  const { window, runs, truncated, selectedVersionId, selectedRuns } =
    await selectIntelRuns(input);
  const previousWindow = {
    start: new Date(
      Date.parse(window.start) - input.days * DAY_MS,
    ).toISOString(),
    end: window.start,
  };
  const tracker = await repo.getTracker(input.projectId);
  const labels = new Map(
    tracker
      ? (await versionRepo.listVersions(tracker.id)).map((v) => [
          v.id,
          v.version,
        ])
      : [],
  );
  const allFacts = await AiIntelligenceRepository.getFacts(
    runs.map((r) => r.id),
  );
  const selectedIds = new Set(selectedRuns.map((r) => r.id));
  const versionFacts = allFacts.filter((f) => selectedIds.has(f.runId));
  const scoped = applyFilters(versionFacts, input);
  const coverage = intelCoverage(scoped);
  const brands = computeBrands(scoped, input.competitors ?? null);
  const own = brands.find((b) => b.own) ?? null;
  const comparison = await compareWithPrevious(
    input,
    previousWindow,
    selectedVersionId,
    { brands, engines: coverage.engines, runs: coverage.contributingRuns },
  );
  const level = repeatRunLevel(coverage.contributingRuns);
  const filteredAll = applyFilters(allFacts, input);
  const byRun = Object.fromEntries(groupInto(filteredAll, (f) => f.runId));
  const trend = reverse(runs).map((run) => {
    const { overall, byEngine } = own
      ? brandVisibility(byRun[run.id] ?? [], own.domain)
      : { overall: null, byEngine: [] };
    return {
      runId: run.id,
      at: run.createdAt,
      promptSetVersionId: run.promptSetVersionId,
      visibility: overall,
      answers: (byRun[run.id] ?? []).filter(isAnswered).length,
      byEngine: byEngine.map(({ engine, visibility }) => ({
        engine,
        visibility,
      })),
    };
  });
  const answeredScoped = scoped.filter(isAnswered);
  const warnings: string[] = [];
  const excludedRuns = runs.length - selectedRuns.length;
  if (excludedRuns > 0)
    warnings.push(
      `${excludedRuns} run(s) in this period measured a different prompt set and are not in these figures. The trend breaks where the prompt set changed.`,
    );
  if (truncated)
    warnings.push(
      `Only the newest ${MAX_RUNS} runs in this period are included.`,
    );
  if (coverage.failed + coverage.noAnswer + coverage.pending > 0)
    warnings.push(
      `${coverage.failed} failed, ${coverage.noAnswer} empty and ${coverage.pending} unfinished collection(s) are excluded from every rate.`,
    );
  if (selectedVersionId === null && selectedRuns.length)
    warnings.push(
      "These runs were collected before prompt sets were versioned, so their exact prompt list is not recorded.",
    );
  const evidenceDomain =
    input.brand && brands.some((b) => b.domain === input.brand)
      ? input.brand
      : (own?.domain ?? null);
  const ends = selectedRuns.map((r) => r.completedAt ?? r.createdAt);
  return {
    window: { ...window, days: input.days },
    observedWindow: selectedRuns.length
      ? {
          start: selectedRuns[selectedRuns.length - 1].createdAt,
          end: sort(ends, (a, b) => b.localeCompare(a))[0],
        }
      : null,
    promptSet: {
      versions: versionsOf(runs, labels, selectedVersionId),
      selectedVersionId,
      excludedRuns,
    },
    truncated,
    options: {
      engines: sort(unique(versionFacts.map((f) => f.engine)), (a, b) =>
        a.localeCompare(b),
      ),
      topics: sort(unique(versionFacts.map((f) => f.topic)), (a, b) =>
        a.localeCompare(b),
      ),
      intents: sort(
        unique(versionFacts.map((f) => f.intent ?? "unknown")),
        (a, b) => a.localeCompare(b),
      ),
      brands: sort(
        unique(versionFacts.flatMap((f) => f.brands.map((b) => b.domain))).map(
          (domain) => {
            const b = versionFacts
              .flatMap((f) => f.brands)
              .find((x) => x.domain === domain)!;
            return { name: b.name || domain, domain, own: b.own };
          },
        ),
        (a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name),
      ),
    },
    coverage,
    repeatRuns: {
      runCount: coverage.contributingRuns,
      level,
      note: repeatRunNote(level),
    },
    target: own,
    brandsCompared: brands.length,
    leaderboard: brands,
    trend,
    collectionTrend: collectionTrend(runs, filteredAll, own?.domain ?? null),
    comparison: { previousWindow, ...comparison },
    evidence: { brandDomain: evidenceDomain },
    models: coverage.engines.map((engine) => ({
      engine,
      models: sort(
        unique(
          answeredScoped
            .filter((f) => f.engine === engine)
            .flatMap((f) => f.model ?? []),
        ),
        (a, b) => a.localeCompare(b),
      ),
    })),
    warnings,
  };
}
