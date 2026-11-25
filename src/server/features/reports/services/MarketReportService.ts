import { AI_ENGINE_LABELS, aiMarketLabel } from "@/shared/ai-visibility";
import { loadAiIntelligence } from "@/server/features/ai-visibility/services/aiVisibilityIntelligence";
import { FanOutRepository } from "@/server/features/source-intelligence/repositories/FanOutRepository";
import { AppError } from "@/server/lib/errors";
import { ReportService } from "./ReportService";

type Market = { locationCode: number; languageCode: string };
type ReportInput = {
  projectId: string;
  markets: Market[];
  days: 7 | 28 | 90;
};

const esc = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const pct = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;
const marketKey = (market: Market) =>
  `${market.locationCode}:${market.languageCode}`;

export async function getReportMarkets(projectId: string) {
  return (await FanOutRepository.markets(projectId)).map((market) => ({
    ...market,
    label: aiMarketLabel(market),
    key: marketKey(market),
  }));
}

export async function getMarketComparison(input: ReportInput) {
  const available = new Set(
    (await getReportMarkets(input.projectId)).map((market) => market.key),
  );
  const keys = new Set(input.markets.map(marketKey));
  if (
    keys.size !== input.markets.length ||
    [...keys].some((key) => !available.has(key))
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Choose distinct markets with saved runs in this project.",
    );

  const rows = await Promise.all(
    input.markets.map(async (market) => {
      const intel = await loadAiIntelligence({
        projectId: input.projectId,
        ...market,
        days: input.days,
        branded: "all",
      });
      const selected = intel.promptSet.versions.find(
        (version) => version.selected,
      );
      return {
        key: marketKey(market),
        label: aiMarketLabel(market),
        visibility: intel.target?.visibility ?? null,
        citation: intel.target?.citedAnswers.rate ?? null,
        answers: intel.coverage.answered,
        planned: intel.coverage.planned,
        prompts: intel.coverage.prompts,
        engines: intel.coverage.engines,
        promptSet: selected?.version ?? null,
        versionId: intel.promptSet.selectedVersionId,
        truncated: intel.truncated,
        observed: intel.observedWindow,
      };
    }),
  );
  return { rows, days: input.days };
}

export async function saveMarketComparison(
  input: ReportInput,
  scope: { organizationId: string; userId: string },
) {
  const { rows, days } = await getMarketComparison(input);
  const stamp = new Date().toISOString().slice(0, 23).replace("T", " ");
  const title = `AI visibility by market · ${days} days · ${stamp} UTC`;
  const body = rows
    .map((row) => {
      const engines = row.engines
        .map((engine) => AI_ENGINE_LABELS[engine])
        .join(", ");
      const dates = row.observed
        ? `${row.observed.start.slice(0, 10)} to ${row.observed.end.slice(0, 10)}`
        : "No collection";
      return `<tr><th scope="row">${esc(row.label)}</th><td>${pct(row.visibility)}</td><td>${pct(row.citation)}</td>
      <td>${row.answers} / ${row.planned}</td><td>${row.prompts}</td><td>${esc(engines) || "—"}</td>
      <td>${row.promptSet ?? "—"}</td><td>${dates}${row.truncated ? " (most recent runs only)" : ""}</td></tr>`;
    })
    .join("");
  const summary = `Saved AI visibility for ${rows.map((row) => row.label).join(", ")} over the last ${days} days.`;
  return ReportService.saveReport({
    projectId: input.projectId,
    organizationId: scope.organizationId,
    title,
    summary,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AI visibility by market</title>
<style>body{font:16px system-ui;margin:2rem auto;padding:0 1rem;max-width:75rem;color:#171713}section{overflow:auto}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.7rem;text-align:left}p{max-width:65ch;line-height:1.55}</style></head><body>
<h1>AI visibility by market</h1><p>${esc(summary)}</p>
<p>Each row describes the market’s own saved sample. Check engines, prompt set and collection dates before interpreting differences.</p>
<section><table><thead><tr><th>Market</th><th>Visibility</th><th>Cited</th><th>Answers</th><th>Prompts</th><th>Engines</th><th>Prompt set</th><th>Collected</th></tr></thead>
<tbody>${body}</tbody></table></section></body></html>`,
    createdBy: "app",
    createdByUserId: scope.userId,
  });
}
