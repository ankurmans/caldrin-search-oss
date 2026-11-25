import { groupByProp } from "remeda";
import { aiMarketQuery } from "@/shared/ai-market";
import { AiPromptSetVersionRepository as versionRepo } from "../repositories/aiPromptSetVersionRepository";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { AiVisibilityError } from "./aiVisibilityErrors";
import { compareSides } from "./aiMeasurementCompare";
import type { CompareWindowsInput } from "./aiMeasurementSchemas";
import { listRunsForMeasurement } from "./aiMeasurementRuns";
import { loadMeasurementSide } from "./aiMeasurementLoad";
import { linkRunsToLedger } from "./aiMeasurementLedger";
import type {
  MeasurementSelector,
  WindowComparison,
} from "./aiMeasurementTypes";

function selectorOf(
  runIds: string[] | undefined,
  window: { start: string; end: string } | undefined,
): MeasurementSelector {
  if (runIds) return { runIds };
  if (window) return { window };
  throw new AiVisibilityError(
    "COMPARISON_SIDE_REQUIRED",
    "Give each side as run ids or a window.",
  );
}

async function compareWindows(
  projectId: string,
  input: CompareWindowsInput,
): Promise<WindowComparison> {
  const market = aiMarketQuery(input);
  const [before, after] = await Promise.all([
    loadMeasurementSide(
      projectId,
      selectorOf(input.beforeRunIds, input.beforeWindow),
      market,
    ),
    loadMeasurementSide(
      projectId,
      selectorOf(input.afterRunIds, input.afterWindow),
      market,
    ),
  ]);
  return compareSides(
    before.side,
    after.side,
    before.truncated || after.truncated,
  );
}

async function listPromptSetVersions(projectId: string) {
  const tracker = await repo.getTracker(projectId);
  if (!tracker) return [];
  const versions = await versionRepo.listVersions(tracker.id);
  const [members, runCounts] = await Promise.all([
    versionRepo.listMembers(versions.map((v) => v.id)),
    versionRepo.countRunsByVersion(projectId),
  ]);
  const byVersion = groupByProp(members, "versionId");
  return versions.map((version) => ({
    id: version.id,
    version: version.version,
    createdAt: version.createdAt,
    runCount: runCounts.find((row) => row.versionId === version.id)?.runs ?? 0,
    prompts: (byVersion[version.id] ?? []).map(({ promptId, text, topic }) => ({
      id: promptId,
      text,
      topic,
    })),
  }));
}

export const AiMeasurementService = {
  compareWindows,
  listPromptSetVersions,
  listRuns: listRunsForMeasurement,
  linkRunsToLedger,
};
