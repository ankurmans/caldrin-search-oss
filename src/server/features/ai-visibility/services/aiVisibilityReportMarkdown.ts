import { AI_ENGINE_LABELS, type AiTrackerState } from "@/shared/ai-visibility";
import type {
  AiVisibilityIntelligence,
  IntelBrand,
  IntelRate,
} from "@/shared/ai-visibility-intelligence";
import {
  GAP_TYPE_LABELS,
  type CitationGapAnalysis,
  type CitationGapType,
} from "@/shared/citation-gaps";

const MAX_SOURCES = 40;
const GAP_TYPE_ORDER: CitationGapType[] = [
  "missing_commercial_content",
  "missing_comparison_coverage",
  "missing_independent_corroboration",
  "third_party_publisher",
  "brand_information_review",
  "measurement_uncertainty",
];

const pct = (value: number | null) =>
  value === null ? "n/a" : `${Math.round(value * 100)}%`;
const count = (r: IntelRate) =>
  `${r.numerator} of ${r.denominator}${r.rate === null ? "" : ` (${pct(r.rate)})`}`;
const cell = (text: string) => text.replaceAll("|", "\\|").replace(/\s+/g, " ");
const table = (header: string[], rows: string[][]) => [
  `| ${header.join(" | ")} |`,
  `|${header.map(() => "---").join("|")}|`,
  ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
];

function leaderboardRows(brands: IntelBrand[]) {
  return brands.map((b) => [
    String(b.rank ?? "n/a"),
    b.own ? `**${b.name}** (you)` : b.name,
    b.domain,
    pct(b.visibility),
    pct(b.shareOfVoice.rate),
    b.avgPosition.value === null ? "n/a" : b.avgPosition.value.toFixed(1),
    count(b.mention),
    b.mention.numerator === 0 ? "n/a" : count(b.citationAmongMentioned),
  ]);
}

function engineRows(brands: IntelBrand[], engines: string[]) {
  return brands.map((b) => [
    b.own ? `**${b.name}** (you)` : b.name,
    ...engines.map((engine) =>
      pct(b.byEngine.find((e) => e.engine === engine)?.visibility ?? null),
    ),
  ]);
}

/**
 * One self-contained Markdown document of a project's AI visibility from
 * stored answers: setup, scorecard, citation gaps and cited sources. Pure; no
 * provider is called and nothing here is new measurement.
 */
export function buildAiVisibilityReportMarkdown(input: {
  project: { name: string; domain: string };
  tracker: AiTrackerState;
  intelligence: AiVisibilityIntelligence;
  gaps: CitationGapAnalysis;
  generatedAt: Date;
}): string {
  const { project, tracker, intelligence: intel, gaps } = input;
  const target = intel.target;
  const cov = intel.coverage;
  const lines: string[] = [];
  const add = (...l: string[]) => lines.push(...l);

  add(
    `# ${project.name}: AI visibility report`,
    "",
    `Domain \`${project.domain}\`. Generated ${input.generatedAt.toISOString().slice(0, 10)} from stored Caldrin Search answers. Window ${intel.window.start.slice(0, 10)} to ${intel.window.end.slice(0, 10)} (${intel.window.days} days).`,
    "",
    "## Read this first",
    "",
    `- Based on ${cov.answered} answered collections out of ${cov.planned} planned (${cov.noAnswer} with no answer, ${cov.failed} failed), ${cov.prompts} prompts, ${cov.contributingRuns} run(s), ${cov.engines.map((e) => AI_ENGINE_LABELS[e]).join(", ") || "no engines"}.`,
    `- ${intel.repeatRuns.note}`,
    "- This describes the tracked prompts and engines only, not the whole market. A citation means the engine used a page, not that the page endorses any brand.",
  );
  if (!intel.comparison.comparable && intel.comparison.reason)
    add(`- ${intel.comparison.reason}`);
  for (const w of intel.warnings) add(`- ${w}`);
  add("");

  if (target) {
    add(
      "## Headline",
      "",
      `${project.name} is named in ${count(target.mention)} answers and its site is cited in ${count(target.citedAnswers)}. Rank ${target.rank ?? "n/a"} of ${intel.brandsCompared} tracked brands, visibility ${pct(target.visibility)}.`,
      "",
    );
  }

  add("## Tracked setup", "");
  if (tracker.tracker)
    add(
      `Schedule ${tracker.tracker.scheduleInterval}${tracker.tracker.enabled ? "" : " (paused)"}, next check ${tracker.tracker.nextCheckAt ?? "not scheduled"}. Market ${tracker.tracker.locationCode}/${tracker.tracker.languageCode}.`,
      "",
    );
  add(
    `Brands tracked: ${tracker.brands.map((b) => `${b.name} (${b.domain})${b.own ? " [you]" : ""}`).join(", ") || "none"}.`,
    "",
  );
  const prompts = tracker.prompts.filter((p) => !p.archived);
  for (const topic of new Set(prompts.map((p) => p.topic))) {
    add(`**${topic}**`, "");
    for (const p of prompts.filter((x) => x.topic === topic))
      add(
        `- ${p.text}${p.paused ? " (paused)" : ""}${p.branded ? " (branded)" : ""}${p.intent ? ` [${p.intent}]` : ""}`,
      );
    add("");
  }

  add("## Visibility Insights", "");
  add(
    ...table(
      [
        "#",
        "Brand",
        "Domain",
        "Visibility",
        "Share of voice",
        "Avg. position",
        "Named in",
        "Cited when named",
      ],
      leaderboardRows(intel.leaderboard),
    ),
    "",
  );
  add(
    "Visibility by engine (share of answers naming the brand, engines weighted equally):",
    "",
    ...table(
      ["Brand", ...cov.engines.map((e) => AI_ENGINE_LABELS[e])],
      engineRows(intel.leaderboard, cov.engines),
    ),
    "",
  );

  add("## Citation Gaps", "");
  if (!gaps.findings.length) add("No findings.", "");
  for (const type of GAP_TYPE_ORDER) {
    const group = gaps.findings.filter((f) => f.type === type);
    if (!group.length) continue;
    add(`### ${GAP_TYPE_LABELS[type]}`, "");
    for (const f of group) {
      add(
        `- **${f.title}** (${f.priority} priority, ${f.promptGroup}${f.uncertain ? ", small sample" : ""})`,
        `  - ${f.summary}`,
        `  - Suggested: ${f.suggestedAction} Effort: ${f.effort.level}, ${f.effort.reason}.`,
        `  - Why this priority: ${f.priorityReason}`,
      );
      if (f.competitors.length)
        add(
          `  - Competitors in these answers: ${f.competitors.map((c) => `${c.name} (${c.answers})`).join(", ")}`,
        );
      if (f.sources.length)
        add(
          `  - Cited sources: ${f.sources.map((s) => `${s.domain} (${s.answers})`).join(", ")}`,
        );
      add(`  - Answer IDs: ${f.answerIds.join(", ") || "none"}`);
    }
    add("");
  }

  add(
    `## Cited sources (top ${Math.min(MAX_SOURCES, gaps.sources.length)} of ${gaps.sources.length})`,
    "",
    ...table(
      ["Domain", "Owner", "Answers", "Prompts", "Brands named alongside"],
      gaps.sources.slice(0, MAX_SOURCES).map((s) => [
        s.domain,
        s.kind === "own"
          ? "you"
          : s.kind === "competitor"
            ? `competitor${s.brandName ? ` (${s.brandName})` : ""}`
            : "third party",
        String(s.answers),
        String(s.prompts),
        s.brandsNamed
          .slice(0, 3)
          .map((b) => `${b.name} (${b.answers})`)
          .join(", ") || "none",
      ]),
    ),
    "",
  );

  const notes = [...gaps.notes];
  if (notes.length) add("## Notes", "", ...notes.map((n) => `- ${n}`), "");
  add(
    "Read the full text of any answer with `get_ai_visibility_answer` and the answer IDs above.",
  );
  return lines.join("\n");
}
