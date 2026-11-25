import { aiMarketQuery } from "@/shared/ai-market";
import { groupByProp, sort, unique } from "remeda";
import { AiMeasurementRepository as measurementRepo } from "../repositories/aiMeasurementRepository";
import { AiPromptSetVersionRepository as versionRepo } from "../repositories/aiPromptSetVersionRepository";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import type { ListRunsInput } from "./aiMeasurementSchemas";

/** The most runs one listing returns; the picker offers recent ones first. */
export const MAX_LISTED_RUNS = 200;

export interface MeasurementRunSummary {
  id: string;
  createdAt: string;
  completedAt: string | null;
  /** "partial" runs have some failed answers; they still count where answered. */
  status: "completed" | "partial";
  trigger: "baseline" | "scheduled" | "manual";
  trackerId: string;
  /** Null for runs from before prompt-set versioning. */
  promptSetVersionId: string | null;
  promptSetVersion: number | null;
  promptSetLabel: string;
  engines: string[];
  /** Models providers reported; empty when none did. */
  models: string[];
  /** Distinct prompts the run asked (per engine, the most any engine asked). */
  promptsCount: number;
  locationCode: number;
  languageCode: string;
  /**
   * Runs with the same key measured the same prompt set on the same engines
   * in the same market, so they can sit on one side of a comparison and be
   * compared with each other. The own brand is checked at comparison time.
   */
  comparableKey: string;
}

export interface MeasurementRunList {
  runs: MeasurementRunSummary[];
  /** True when older runs inside the range were left out. */
  truncated: boolean;
}

export async function listRunsForMeasurement(
  projectId: string,
  input: ListRunsInput,
): Promise<MeasurementRunList> {
  const found = await measurementRepo.listFinishedRuns(
    projectId,
    input,
    MAX_LISTED_RUNS + 1,
    aiMarketQuery(input),
  );
  const truncated = found.length > MAX_LISTED_RUNS;
  const runs = found.slice(0, MAX_LISTED_RUNS);
  if (!runs.length) return { runs: [], truncated };

  const tracker = await repo.getTracker(projectId);
  const [shapes, versions] = await Promise.all([
    measurementRepo.getRunShapes(runs.map((run) => run.id)),
    tracker ? versionRepo.listVersions(tracker.id) : [],
  ]);
  const shapesByRun = groupByProp(shapes, "runId");
  const versionNumber = new Map(versions.map((v) => [v.id, v.version]));

  return {
    truncated,
    runs: runs.map((run) => {
      const rows = shapesByRun[run.id] ?? [];
      const engines = sort(unique(rows.map((row) => row.engine)), (a, b) =>
        a.localeCompare(b),
      );
      const version = run.promptSetVersionId
        ? (versionNumber.get(run.promptSetVersionId) ?? null)
        : null;
      return {
        id: run.id,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        status: run.status === "partial" ? "partial" : "completed",
        trigger: run.trigger,
        trackerId: run.trackerId,
        promptSetVersionId: run.promptSetVersionId,
        promptSetVersion: version,
        promptSetLabel: !run.promptSetVersionId
          ? "Before prompt-set versioning"
          : version === null
            ? "Unknown prompt set"
            : `Prompt set v${version}`,
        engines,
        models: sort(
          unique(rows.flatMap((row) => (row.model ? [row.model] : []))),
          (a, b) => a.localeCompare(b),
        ),
        promptsCount: Math.max(0, ...rows.map((row) => row.prompts)),
        locationCode: run.locationCode,
        languageCode: run.languageCode,
        comparableKey: [
          run.promptSetVersionId ?? "unversioned",
          engines.join(","),
          `${run.locationCode}:${run.languageCode}`,
        ].join("|"),
      };
    }),
  };
}
