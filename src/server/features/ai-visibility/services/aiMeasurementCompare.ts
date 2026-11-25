import { ATTRIBUTION_NOTE } from "@/server/features/ledger/types";
import { weakerLevel, metricChange } from "./aiMeasurementStats";
import type {
  ComparabilityCode,
  Measurement,
  MeasurementChange,
  SideMeasurement,
  WindowComparison,
} from "./aiMeasurementTypes";

type Reason = { code: ComparabilityCode; message: string };

const sameList = (a: unknown[], b: unknown[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

function sideReasons(name: "before" | "after", side: SideMeasurement) {
  const reasons: Reason[] = [];
  if (!side.runCount)
    reasons.push({
      code: "no_runs",
      message: `The ${name} side has no runs in this project.`,
    });
  else if (!side.overall.mention.denominator)
    reasons.push({
      code: "no_answers",
      message: `The ${name} side has no answered observations (failed, pending and no-answer results are excluded), so it has no rate.`,
    });
  if (side.promptSetVersionIds.includes(null))
    reasons.push({
      code: "unversioned_runs",
      message: `The ${name} side includes runs from before prompt-set versioning, so their prompt set is unknown.`,
    });
  if (side.promptSetVersionIds.filter((id) => id !== null).length > 1)
    reasons.push({
      code: "mixed_prompt_set_versions",
      message: `The ${name} side mixes runs of different prompt-set versions. Pick runs of one version.`,
    });
  if (side.markets.length > 1)
    reasons.push({
      code: "mixed_markets",
      message: `The ${name} side mixes runs from more than one location or language. Name one market, or pick runs from one.`,
    });
  return reasons;
}

/**
 * A comparison is like-for-like only when both sides measured the same prompt
 * set on the same engines in the same market for the same brand. Anything else
 * would compare different questions, so no change is offered.
 */
function comparability(
  before: SideMeasurement,
  after: SideMeasurement,
  truncated: boolean,
): Reason[] {
  const reasons = [
    ...sideReasons("before", before),
    ...sideReasons("after", after),
  ];
  if (truncated)
    reasons.push({
      code: "window_truncated",
      message:
        "A window holds more runs than one comparison reads. Narrow the window.",
    });
  if (before.runIds.some((id) => after.runIds.includes(id)))
    reasons.push({
      code: "overlapping_runs",
      message: "The same run appears on both sides.",
    });
  const [beforeVersion, afterVersion] = [before, after].map((side) =>
    side.promptSetVersionIds.length === 1 ? side.promptSetVersionIds[0] : null,
  );
  if (beforeVersion && afterVersion && beforeVersion !== afterVersion)
    reasons.push({
      code: "prompt_set_version_mismatch",
      message:
        "The two sides measured different prompt sets, so their rates answer different questions.",
    });
  if (before.runCount && after.runCount) {
    if (!sameList(before.engines, after.engines))
      reasons.push({
        code: "engine_set_mismatch",
        message: `The sides measured different engines (${before.engines.join(", ")} vs ${after.engines.join(", ")}).`,
      });
    if (!sameList(before.markets, after.markets))
      reasons.push({
        code: "market_mismatch",
        message:
          "The sides were collected in different locations or languages.",
      });
    if (!sameList(before.ownBrands, after.ownBrands))
      reasons.push({
        code: "own_brand_mismatch",
        message:
          "The tracked brand name or domain changed between the sides, so the rates measure different brands.",
      });
  }
  return reasons;
}

function change(
  before: Measurement,
  after: Measurement,
  reliability: WindowComparison["reliability"],
): MeasurementChange {
  return {
    engine: after.engine,
    mention: metricChange(before.mention, after.mention, reliability),
    ownCitation: metricChange(
      before.ownCitation,
      after.ownCitation,
      reliability,
    ),
    recommendation: metricChange(
      before.recommendation,
      after.recommendation,
      reliability,
    ),
  };
}

export function compareSides(
  before: SideMeasurement,
  after: SideMeasurement,
  truncated: boolean,
): WindowComparison {
  const reasons = comparability(before, after, truncated);
  const reliability = weakerLevel(
    before.repeatRuns.level,
    after.repeatRuns.level,
  );
  const comparable = reasons.length === 0;
  return {
    attribution: "observed_only",
    attributionNote: ATTRIBUTION_NOTE,
    comparable,
    reasons,
    before,
    after,
    changes: comparable
      ? {
          overall: change(before.overall, after.overall, reliability),
          byEngine: after.byEngine.flatMap((engine) => {
            const earlier = before.byEngine.find(
              (m) => m.engine === engine.engine,
            );
            return earlier ? [change(earlier, engine, reliability)] : [];
          }),
        }
      : null,
    reliability,
  };
}
