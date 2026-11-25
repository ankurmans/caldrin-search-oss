import {
  metricChange,
  toRate,
} from "@/server/features/ai-visibility/services/aiMeasurementStats";
import type { loadMeasurementSide } from "@/server/features/ai-visibility/services/aiMeasurementLoad";
import type {
  MetricChange,
  WindowComparison,
} from "@/server/features/ai-visibility/services/aiMeasurementTypes";
import type { AlertConditions, AlertDetails, AlertMetric } from "../types";
import {
  conditionsText,
  metricFact,
  metricLine,
  rateText,
} from "./monitoringText";

export type LoadedSide = Awaited<ReturnType<typeof loadMeasurementSide>>;

/** An alert before it is scoped to a project and stamped. */
interface AlertDraft {
  kind: "visibility_change" | "competitor_change" | "source_change";
  title: string;
  body: string;
  details: AlertDetails;
  dedupeKey: string;
}

const changed = (change: MetricChange) =>
  change.difference !== null && change.difference !== 0;

const sideOf = ({ period, side }: { period: string; side: LoadedSide }) => ({
  period,
  window: side.side.observedWindow,
  runs: side.side.runCount,
  answered: side.side.overall.counts.answered,
});

export function comparisonConditions(input: {
  comparison: WindowComparison;
  before: { period: string; side: LoadedSide } | null;
  after: { period: string; side: LoadedSide };
  promptSetVersion: number | null;
}): AlertConditions {
  const { comparison, before, after } = input;
  return {
    promptSetVersionIds: after.side.side.promptSetVersionIds,
    promptSetVersion: input.promptSetVersion,
    engines: after.side.side.engines,
    markets: after.side.side.markets,
    before: before ? sideOf(before) : null,
    after: sideOf(after),
    reliability: comparison.reliability,
  };
}

/** Answers citing each domain, over every engine, from the side's full source counts. */
function domainCounts(side: LoadedSide) {
  const totals = new Map<string, number>();
  for (const row of side.data.sources.domains)
    totals.set(row.key, (totals.get(row.key) ?? 0) + row.answers);
  return totals;
}

function sourceChanges(
  before: LoadedSide,
  after: LoadedSide,
  comparison: WindowComparison,
) {
  const beforeTop = before.side.overall.topCitedDomains.map((d) => d.key);
  const afterTop = after.side.overall.topCitedDomains.map((d) => d.key);
  const beforeCounts = domainCounts(before);
  const afterCounts = domainCounts(after);
  // The share's denominator is the answers the own-brand rates count.
  const beforeDenominator = before.side.overall.ownCitation.denominator;
  const afterDenominator = after.side.overall.ownCitation.denominator;
  const entry = (domain: string, direction: "appeared" | "dropped") => ({
    domain,
    direction,
    change: metricChange(
      toRate(beforeCounts.get(domain) ?? 0, beforeDenominator),
      toRate(afterCounts.get(domain) ?? 0, afterDenominator),
      comparison.reliability,
    ),
  });
  return [
    ...afterTop
      .filter((d) => !beforeTop.includes(d))
      .map((d) => entry(d, "appeared")),
    ...beforeTop
      .filter((d) => !afterTop.includes(d))
      .map((d) => entry(d, "dropped")),
  ];
}

/**
 * The alerts one comparable pair of collection days warrants: own-brand
 * rates, competitor mention rates and top cited domains, each written only
 * when something changed. Every one carries the comparison's conditions and
 * metricChange's verdict.
 */
export function buildChangeAlerts(input: {
  comparison: WindowComparison;
  before: { period: string; side: LoadedSide };
  after: { period: string; side: LoadedSide };
  promptSetVersion: number | null;
}): AlertDraft[] {
  const { comparison, before, after } = input;
  if (!comparison.comparable || !comparison.changes) return [];
  const conditions = comparisonConditions(input);
  const footer = `${conditionsText(conditions)}\n${comparison.attributionNote}`;
  const pair = `${before.period}:${after.period}`;
  const details = (metrics: AlertMetric[]): AlertDetails => ({
    conditions,
    metrics,
    attributionNote: comparison.attributionNote,
  });
  const alerts: AlertDraft[] = [];

  const own = [
    {
      metric: "own_mention_rate",
      label: "Own-brand mention rate",
      change: comparison.changes.overall.mention,
    },
    {
      metric: "own_citation_rate",
      label: "Own-domain citation rate",
      change: comparison.changes.overall.ownCitation,
    },
  ].filter((item) => changed(item.change));
  if (own.length)
    alerts.push({
      kind: "visibility_change",
      title: `AI visibility changed: ${before.period} → ${after.period}`,
      body: [...own.map((i) => metricLine(i.label, i.change)), "", footer].join(
        "\n",
      ),
      details: details(own.map((i) => metricFact(i.metric, "own", i.change))),
      dedupeKey: `visibility_change:${pair}`,
    });

  const competitors = after.side.side.overall.competitors.flatMap((rival) => {
    const earlier = before.side.side.overall.competitors.find(
      (c) => c.domain === rival.domain,
    );
    if (!earlier) return [];
    const change = metricChange(
      earlier.mention,
      rival.mention,
      comparison.reliability,
    );
    return changed(change) ? [{ rival, change }] : [];
  });
  if (competitors.length)
    alerts.push({
      kind: "competitor_change",
      title: `Competitor mentions changed: ${before.period} → ${after.period}`,
      body: [
        ...competitors.map(({ rival, change }) =>
          metricLine(`${rival.name} (${rival.domain}) mention rate`, change),
        ),
        "",
        footer,
      ].join("\n"),
      details: details(
        competitors.map(({ rival, change }) =>
          metricFact("competitor_mention_rate", rival.domain, change),
        ),
      ),
      dedupeKey: `competitor_change:${pair}`,
    });

  const sources = sourceChanges(before.side, after.side, comparison);
  if (sources.length)
    alerts.push({
      kind: "source_change",
      title: `Top cited domains changed: ${before.period} → ${after.period}`,
      body: [
        ...sources.map(({ domain, direction, change }) =>
          metricLine(
            `${domain} ${direction === "appeared" ? "entered" : "left"} the top cited domains; answers citing it`,
            change,
          ),
        ),
        "",
        footer,
      ].join("\n"),
      details: details(
        sources.map(({ domain, direction, change }) =>
          metricFact(`top_domain_${direction}`, domain, change),
        ),
      ),
      dedupeKey: `source_change:${pair}`,
    });
  return alerts;
}

/** Plain-text figures of one side, for the weekly summary. */
export function sideFigures(side: LoadedSide) {
  const overall = side.side.overall;
  const lines = [
    `Own-brand mention rate: ${rateText(overall.mention)}.`,
    `Own-domain citation rate: ${rateText(overall.ownCitation)}.`,
  ];
  for (const rival of overall.competitors)
    lines.push(
      `${rival.name} (${rival.domain}) mention rate: ${rateText(rival.mention)}.`,
    );
  return lines;
}
