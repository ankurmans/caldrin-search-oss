import type {
  ChangeVerdict,
  MetricChange,
  Rate,
  RepeatRunLevel,
} from "./aiMeasurementTypes";
import {
  MIN_RUNS_FOR_ANALYSIS,
  MIN_RUNS_FOR_CLIENT_NUMBER,
} from "./aiMeasurementTypes";

export function toRate(numerator: number, denominator: number): Rate {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
  };
}

/** 95% Wilson score interval of a proportion. */
function wilsonInterval(numerator: number, denominator: number) {
  const z = 1.96;
  const p = numerator / denominator;
  const scale = 1 + (z * z) / denominator;
  const center = (p + (z * z) / (2 * denominator)) / scale;
  const margin =
    (z *
      Math.sqrt(
        (p * (1 - p)) / denominator + (z * z) / (4 * denominator * denominator),
      )) /
    scale;
  return { low: center - margin, high: center + margin };
}

export function repeatRunLevel(runCount: number): RepeatRunLevel {
  if (runCount <= 1) return "single_run";
  if (runCount < MIN_RUNS_FOR_ANALYSIS) return "below_analysis_floor";
  if (runCount < MIN_RUNS_FOR_CLIENT_NUMBER) return "below_client_number_floor";
  return "adequate";
}

const REPEAT_RUN_NOTES: Record<RepeatRunLevel, string> = {
  single_run:
    "One run is one sample from a stochastic answer, not a rate. Repeat the check before reading any difference.",
  below_analysis_floor: `Fewer than ${MIN_RUNS_FOR_ANALYSIS} runs: too few repeats to separate a real difference from run-to-run noise.`,
  below_client_number_floor: `Fewer than ${MIN_RUNS_FOR_CLIENT_NUMBER} runs: usable for internal analysis, not as a client-facing number.`,
  adequate: `${MIN_RUNS_FOR_CLIENT_NUMBER} or more runs. Rates still describe observed answers only.`,
};

export const repeatRunNote = (level: RepeatRunLevel) => REPEAT_RUN_NOTES[level];

const LEVEL_ORDER: RepeatRunLevel[] = [
  "single_run",
  "below_analysis_floor",
  "below_client_number_floor",
  "adequate",
];

export const weakerLevel = (a: RepeatRunLevel, b: RepeatRunLevel) =>
  LEVEL_ORDER.indexOf(a) <= LEVEL_ORDER.indexOf(b) ? a : b;

export function metricChange(
  before: Rate,
  after: Rate,
  reliability: RepeatRunLevel,
): MetricChange {
  const difference =
    before.rate !== null && after.rate !== null
      ? after.rate - before.rate
      : null;
  let verdict: ChangeVerdict;
  if (difference === null) verdict = "not_assessable";
  else if (
    reliability === "single_run" ||
    reliability === "below_analysis_floor"
  )
    verdict = "insufficient_runs";
  else {
    const a = wilsonInterval(before.numerator, before.denominator);
    const b = wilsonInterval(after.numerator, after.denominator);
    verdict =
      a.high < b.low || b.high < a.low ? "outside_noise" : "within_noise";
  }
  return { before, after, difference, verdict };
}
