import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import {
  ATTRIBUTION_NOTE,
  type LedgerScope,
} from "@/server/features/ledger/types";
import { AiPromptSetVersionRepository as versionRepo } from "../repositories/aiPromptSetVersionRepository";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { compareSides } from "./aiMeasurementCompare";
import type { LinkRunsInput } from "./aiMeasurementSchemas";
import { loadMeasurementSide } from "./aiMeasurementLoad";
import { summarizeSide } from "./aiMeasurementSide";
import type { Measurement } from "./aiMeasurementTypes";

/** An expected, user-facing refusal; server functions return it as a result. */
export class AiMeasurementRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiMeasurementRefusal";
  }
}

const METRICS = [
  { metric: "ai_own_mention_rate", pick: (m: Measurement) => m.mention },
  { metric: "ai_own_citation_rate", pick: (m: Measurement) => m.ownCitation },
  {
    metric: "ai_own_recommendation_rate",
    pick: (m: Measurement) => m.recommendation,
  },
] as const;

/**
 * Records each run's own-brand rates as ledger observations. A run that failed
 * outright, or has no answered observation for a metric, records nothing for
 * it. Baseline and follow-up runs must be like-for-like, and the entry says
 * where each run belongs in time. Recorded readings never show that the change
 * caused a difference.
 */
export async function linkRunsToLedger(
  scope: LedgerScope,
  input: LinkRunsInput,
) {
  const { projectId } = scope;
  // Throws the ledger's own refusal for an unknown entry.
  const detail = await LedgerService.getEntry(projectId, input.entryId);
  const [baseline, followUp] = await Promise.all([
    loadMeasurementSide(projectId, { runIds: input.baselineRunIds }),
    loadMeasurementSide(projectId, { runIds: input.followUpRunIds }),
  ]);
  const comparison = compareSides(baseline.side, followUp.side, false);
  if (!comparison.comparable)
    throw new AiMeasurementRefusal(
      `These runs are not like-for-like: ${comparison.reasons.map((r) => r.message).join(" ")}`,
    );
  assertTiming(detail.entry, baseline.runs, followUp.runs);

  const tracker = await repo.getTracker(projectId);
  const versions = tracker ? await versionRepo.listVersions(tracker.id) : [];
  const versionNumber = versions.find(
    (v) => v.id === baseline.side.promptSetVersionIds[0],
  )?.version;
  const done = new Set(
    detail.observations
      .filter((o) => o.source === "ai_visibility")
      .map((o) => `${o.phase}|${o.metric}|${o.aiRunId}`),
  );
  let recorded = 0;
  let skipped = 0;
  for (const [phase, loaded] of [
    ["baseline", baseline],
    ["follow_up", followUp],
  ] as const) {
    for (const run of loaded.runs) {
      const perRun = summarizeSide({
        ...loaded.data,
        runs: [run],
        facts: loaded.data.facts.filter((f) => f.runId === run.id),
      }).overall;
      for (const { metric, pick } of METRICS) {
        const rate = pick(perRun);
        if (rate.rate === null) continue;
        if (done.has(`${phase}|${metric}|${run.id}`)) {
          skipped++;
          continue;
        }
        await LedgerService.recordObservation(scope, input.entryId, {
          phase,
          source: "ai_visibility",
          metric,
          value: rate.rate,
          numerator: rate.numerator,
          denominator: rate.denominator,
          windowStart: run.createdAt,
          windowEnd: run.completedAt ?? run.createdAt,
          aiRunId: run.id,
          note: [
            ATTRIBUTION_NOTE,
            `Prompt set version ${versionNumber ?? "unknown"}; engines ${baseline.side.engines.join(", ")}.`,
            `One run; ${comparison.before.repeatRuns.runCount} baseline and ${comparison.after.repeatRuns.runCount} follow-up runs linked (${comparison.reliability.replaceAll("_", " ")}).`,
          ].join(" "),
        });
        recorded++;
      }
    }
  }
  return {
    attribution: "observed_only" as const,
    attributionNote: ATTRIBUTION_NOTE,
    recorded,
    skipped,
    comparison,
  };
}

function assertTiming(
  entry: { executedAt: string | null; publicationStatus: string },
  baselineRuns: { createdAt: string }[],
  followUpRuns: { createdAt: string }[],
) {
  if (entry.publicationStatus !== "published")
    throw new AiMeasurementRefusal(
      "Only a published change has a follow-up to measure. This change is not published.",
    );
  if (!entry.executedAt) return;
  if (baselineRuns.some((run) => run.createdAt > entry.executedAt!))
    throw new AiMeasurementRefusal(
      "A baseline run was collected after the change was executed.",
    );
  if (followUpRuns.some((run) => run.createdAt <= entry.executedAt!))
    throw new AiMeasurementRefusal(
      "A follow-up run was collected before the change was executed.",
    );
}
