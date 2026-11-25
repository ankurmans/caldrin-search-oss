import type {
  ChangeVerdict,
  MetricChange,
  Rate,
} from "@/server/features/ai-visibility/services/aiMeasurementTypes";
import type { AlertConditions, AlertMetric } from "../types";

// Plain-text wording shared by every monitoring alert. A difference is only
// ever described with the verdict metricChange gave it.

const VERDICT_WORDING: Record<ChangeVerdict, string> = {
  outside_noise: "outside run-to-run noise (says nothing about cause)",
  within_noise: "within noise",
  insufficient_runs: "too few runs to judge",
  not_assessable: "not assessable",
};

const verdictWording = (verdict: ChangeVerdict) => VERDICT_WORDING[verdict];

export function rateText(rate: { numerator: number; denominator: number }) {
  if (rate.denominator === 0) return "no answers";
  const percent = Math.round((rate.numerator / rate.denominator) * 100);
  return `${rate.numerator}/${rate.denominator} (${percent}%)`;
}

/** A changed metric as a stored fact. */
export function metricFact(
  metric: string,
  subject: string,
  change: MetricChange,
): AlertMetric {
  return {
    metric,
    subject,
    before: counts(change.before),
    after: counts(change.after),
    difference: change.difference,
    verdict: change.verdict,
  };
}

const counts = (rate: Rate) => ({
  numerator: rate.numerator,
  denominator: rate.denominator,
});

/** "Own-brand mention rate: 4/10 (40%) → 7/10 (70%); too few runs to judge." */
export function metricLine(label: string, change: MetricChange) {
  return `${label}: ${rateText(change.before)} → ${rateText(change.after)}; ${verdictWording(change.verdict)}.`;
}

function sideText(side: NonNullable<AlertConditions["before"]>) {
  return `${side.period} (${side.runs} ${side.runs === 1 ? "run" : "runs"}, ${side.answered} answered)`;
}

/** The like-for-like conditions, stated on every comparison alert. */
export function conditionsText(conditions: AlertConditions) {
  const ids = conditions.promptSetVersionIds;
  let version = "one prompt-set version";
  if (ids.length !== 1 || ids[0] === null)
    version = "mixed or unversioned prompt sets";
  else if (conditions.promptSetVersion !== null)
    version = `prompt set v${conditions.promptSetVersion}`;
  const scope = `${version}, engines ${conditions.engines.join(", ")}, market ${conditions.markets.join(", ")}`;
  const lines = [
    conditions.before
      ? `Compared like for like: ${scope}.`
      : `Measured with ${scope}.`,
  ];
  if (conditions.before)
    lines.push(
      `Before: ${sideText(conditions.before)}. After: ${sideText(conditions.after)}.`,
    );
  else lines.push(`Period: ${sideText(conditions.after)}.`);
  lines.push(
    "Answers with no result (no answer, failed, pending) are left out of every rate.",
  );
  return lines.join("\n");
}
