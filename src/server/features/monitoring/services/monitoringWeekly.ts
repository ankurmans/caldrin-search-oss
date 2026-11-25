import { compareSides } from "@/server/features/ai-visibility/services/aiMeasurementCompare";
import { loadMeasurementSide } from "@/server/features/ai-visibility/services/aiMeasurementLoad";
import { MonitoringRepository as repo } from "../repositories/MonitoringRepository";
import type { AlertDetails } from "../types";
import {
  comparisonConditions,
  sideFigures,
  type LoadedSide,
} from "./monitoringChanges";
import { conditionsText, metricFact, metricLine } from "./monitoringText";

const DAY_MS = 86_400_000;

/** The ISO week (Monday to Sunday, UTC) holding `date`. */
export function isoWeek(date: Date) {
  const day = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const monday = day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS;
  const thursday = new Date(monday + 3 * DAY_MS);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / DAY_MS / 7) + 1;
  const start = new Date(monday).toISOString();
  const end = new Date(monday + 7 * DAY_MS - 1).toISOString();
  return {
    label: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    window: { start, end },
    firstDay: start.slice(0, 10),
    lastDay: end.slice(0, 10),
  };
}

async function versionNumberOf(projectId: string, side: LoadedSide) {
  const ids = side.side.promptSetVersionIds;
  if (ids.length !== 1 || !ids[0]) return null;
  return repo.getPromptSetVersionNumber(projectId, ids[0]);
}

/**
 * The plain-text summary of the last complete ISO week before `now`, with the
 * change against the week before it when the two are comparable. Null when the
 * week has no answered run.
 */
export async function buildWeeklySummary(projectId: string, now: Date) {
  const week = isoWeek(new Date(now.getTime() - 7 * DAY_MS));
  const prior = isoWeek(new Date(now.getTime() - 14 * DAY_MS));
  const current = await loadMeasurementSide(projectId, {
    window: week.window,
  });
  if (!current.side.overall.mention.denominator) return null;
  const previous = await loadMeasurementSide(projectId, {
    window: prior.window,
  });
  const comparison = compareSides(
    previous.side,
    current.side,
    current.truncated || previous.truncated,
  );
  const ids = current.side.promptSetVersionIds;
  // The week's own figures are like-for-like only when every run measured the
  // same versioned prompt set and none were left out.
  const consistent = ids.length === 1 && ids[0] !== null && !current.truncated;
  const conditions = comparisonConditions({
    comparison,
    before: comparison.comparable
      ? { period: prior.label, side: previous }
      : null,
    after: { period: week.label, side: current },
    promptSetVersion: await versionNumberOf(projectId, current),
  });
  const overall = current.side.overall;
  const lines = [
    `Week ${week.label} (${week.firstDay} to ${week.lastDay}).`,
    ...sideFigures(current),
  ];
  if (!consistent)
    lines.push(
      current.truncated
        ? "This week holds more runs than one summary reads, so the figures cover only its first runs."
        : "These figures combine runs of different or unversioned prompt sets, so they mix different questions.",
    );
  let metrics: AlertDetails["metrics"];
  if (comparison.changes) {
    const { mention, ownCitation } = comparison.changes.overall;
    lines.push(
      "",
      `Against week ${prior.label}:`,
      metricLine("Own-brand mention rate", mention),
      metricLine("Own-domain citation rate", ownCitation),
    );
    metrics = [
      metricFact("own_mention_rate", "own", mention),
      metricFact("own_citation_rate", "own", ownCitation),
    ];
  } else {
    lines.push(
      "",
      `Not compared with week ${prior.label}: ${comparison.reasons.map((r) => r.message).join(" ")}`,
    );
    metrics = [
      ["own_mention_rate", overall.mention] as const,
      ["own_citation_rate", overall.ownCitation] as const,
    ].map(([metric, rate]) => ({
      metric,
      subject: "own",
      before: null,
      after: { numerator: rate.numerator, denominator: rate.denominator },
      difference: null,
      verdict: null,
    }));
  }
  lines.push("", conditionsText(conditions), comparison.attributionNote);
  const details: AlertDetails = {
    conditions,
    metrics,
    attributionNote: comparison.attributionNote,
  };
  return {
    period: week.label,
    title: `Weekly AI visibility summary: ${week.label}`,
    body: lines.join("\n"),
    details,
    comparable: consistent,
  };
}
