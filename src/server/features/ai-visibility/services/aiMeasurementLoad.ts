import { unique } from "remeda";
import type { AiMarketQuery } from "@/shared/ai-market";
import { AiMeasurementRepository as measurementRepo } from "../repositories/aiMeasurementRepository";
import { summarizeSide } from "./aiMeasurementSide";
import {
  MAX_RUNS_PER_SIDE,
  type MeasurementSelector,
} from "./aiMeasurementTypes";
import { AiVisibilityError } from "./aiVisibilityErrors";

/** Runs and their answers for one side, always scoped to the project. */
export async function loadMeasurementSide(
  projectId: string,
  selector: MeasurementSelector,
  market?: AiMarketQuery | null,
) {
  let truncated = false;
  let runs;
  if ("runIds" in selector) {
    const wanted = unique(selector.runIds);
    if (wanted.length > MAX_RUNS_PER_SIDE)
      throw new AiVisibilityError(
        "TOO_MANY_RUNS",
        `Compare at most ${MAX_RUNS_PER_SIDE} runs per side.`,
      );
    runs = await measurementRepo.getProjectRuns(projectId, wanted);
    // Another project's run ids look exactly like missing ones.
    if (runs.length !== wanted.length)
      throw new AiVisibilityError(
        "RUN_NOT_FOUND",
        "A run is not available in the selected project.",
      );
  } else {
    const found = await measurementRepo.listFinishedRunsInWindow(
      projectId,
      selector.window,
      MAX_RUNS_PER_SIDE + 1,
      market,
    );
    truncated = found.length > MAX_RUNS_PER_SIDE;
    runs = found.slice(0, MAX_RUNS_PER_SIDE);
  }
  const runIds = runs.map((run) => run.id);
  const [facts, competitors, sources] = await Promise.all([
    measurementRepo.getAnswerFacts(runIds),
    measurementRepo.getCompetitorMatches(runIds),
    measurementRepo.getCitedSources(runIds),
  ]);
  const data = { runs, facts, competitors, sources };
  return { truncated, runs, data, side: summarizeSide(data) };
}
