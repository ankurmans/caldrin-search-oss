import { resolveDateRange } from "@/server/features/gsc/searchAnalytics";
import {
  previousPeriod,
  sumSearchTotals,
} from "@/server/features/gsc/searchPerformanceReport";
import { GscService } from "@/server/features/gsc/services/GscService";
import { ReportRepository } from "@/server/features/reports/repositories/ReportRepository";
import { ReportService } from "@/server/features/reports/services/ReportService";
import { CommandCentreService } from "./CommandCentreService";

const esc = (value: string | number | null) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

type Summary = Awaited<ReturnType<typeof CommandCentreService.get>>;
type Totals = ReturnType<typeof sumSearchTotals>;

// Search Console is the only first-party source read here, and it is free. A
// property that is not connected, or a read that fails, leaves the section out.
async function readSearchConsole(projectId: string) {
  try {
    const { startDate, endDate } = resolveDateRange({
      dateRange: "last_28_days",
    });
    const prev = previousPeriod(startDate, endDate);
    const [current, previous] = await Promise.all([
      GscService.getPerformance({
        projectId,
        startDate,
        endDate,
        type: "web",
        dimensions: ["date"],
        rowLimit: 200,
      }),
      GscService.getPerformance({
        projectId,
        startDate: prev.startDate,
        endDate: prev.endDate,
        type: "web",
        dimensions: ["date"],
        rowLimit: 200,
      }),
    ]);
    return {
      startDate,
      endDate,
      totals: sumSearchTotals(current.rows),
      previous: sumSearchTotals(previous.rows),
    };
  } catch {
    return null;
  }
}

function change(now: number, before: number): string {
  if (before === 0) return "no earlier figure";
  const pct = ((now - before) / before) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs previous period`;
}

const row = (label: string, now: string, delta: string) =>
  `<tr><th>${label}</th><td>${now}</td><td>${delta}</td></tr>`;

function gscSection(
  gsc: NonNullable<Awaited<ReturnType<typeof readSearchConsole>>>,
) {
  const t: Totals = gsc.totals;
  const p: Totals = gsc.previous;
  return `<h2>Organic search (Search Console)</h2>
<p class="note">First-party data, ${esc(gsc.startDate)} to ${esc(gsc.endDate)}. Branded and non-branded queries are combined here; split them on the Organic Search page.</p>
<table><tbody>
${row("Clicks", t.clicks.toLocaleString("en-US"), change(t.clicks, p.clicks))}
${row("Impressions", t.impressions.toLocaleString("en-US"), change(t.impressions, p.impressions))}
${row("Average CTR", `${(t.ctr * 100).toFixed(2)}%`, "")}
${row("Average position", t.position.toFixed(1), "")}
</tbody></table>`;
}

function opportunitiesSection(summary: Summary) {
  const o = summary.opportunities;
  if (!o) return "";
  const rows = o.next
    .map(
      (n) =>
        `<li><strong>${esc(n.query ?? n.pageUrl ?? "Opportunity")}</strong> &middot; ${esc(n.priority)} priority<br><span class="note">${esc(n.reason)}</span></li>`,
    )
    .join("");
  return `<h2>Opportunities</h2>
<p>${o.open} open, ${o.inProgress} in progress.${o.demo > 0 ? " Some come from demo data." : ""}</p>
${rows ? `<ol>${rows}</ol>` : '<p class="note">No open opportunities are stored. Run an analysis from the Opportunities page.</p>'}`;
}

function aiSection(summary: Summary) {
  const ai = summary.ai;
  if (!ai) return "";
  if (!ai.configured)
    return `<h2>AI search</h2><p class="note">No AI Search prompts are tracked yet.</p>`;
  const visibility =
    ai.visibility === null ? "not enough answers yet" : `${ai.visibility}%`;
  return `<h2>AI search</h2>
<p>Visibility across ${ai.trackedPrompts} tracked prompts: ${esc(visibility)}. ${esc(ai.comparisonNote ?? "")}</p>
<p class="note">Figures describe the tracked prompt set only, not all AI answers.</p>`;
}

function executionSection(summary: Summary) {
  const e = summary.execution;
  if (!e) return "";
  return `<h2>Work and approvals</h2>
<p>${e.pendingApprovals} awaiting approval, ${e.approvedNotRun} approved and not run, ${e.failed} failed, ${e.completed} completed, ${e.followUpsDue} follow-ups due.</p>`;
}

function render(title: string, generatedAt: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:15px/1.55 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#1c1b17}
h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:2rem}table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #e6e3d8}.note{color:#6b675b;font-size:.9em}</style></head>
<body><h1>${esc(title)}</h1><p class="note">Built from data already stored for this project on ${esc(generatedAt.slice(0, 10))}. No provider was called to build it.</p>
${body}</body></html>`;
}

async function create(input: {
  projectId: string;
  organizationId: string;
  userId: string;
  projectName: string;
  domain: string | null;
}) {
  const [summary, gsc] = await Promise.all([
    CommandCentreService.get({
      projectId: input.projectId,
      domain: input.domain,
    }),
    readSearchConsole(input.projectId),
  ]);
  const day = summary.generatedAt.slice(0, 10);
  const title = `Search summary ${day}`;
  const html = render(
    `${input.projectName}: search summary`,
    summary.generatedAt,
    [
      gsc ? gscSection(gsc) : "",
      aiSection(summary),
      opportunitiesSection(summary),
      executionSection(summary),
    ].join("\n"),
  );
  // Running it again on the same day updates that day's report in place.
  const existing = await ReportRepository.findReportByTitle(
    input.projectId,
    title,
  );
  return ReportService.saveReport({
    projectId: input.projectId,
    organizationId: input.organizationId,
    reportId: existing?.id,
    title,
    summary: `Stored-data summary of search, AI search, opportunities and work for ${input.projectName}.`,
    html,
    skill: "basic-summary",
    createdBy: "Caldrin Search",
    createdByUserId: input.userId,
  });
}

export const BasicReportService = { create };
