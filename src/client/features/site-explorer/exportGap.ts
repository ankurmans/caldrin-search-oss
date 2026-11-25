import { exportRows } from "@/client/lib/exportRows";
import { exportKeywordGap } from "@/serverFunctions/site-explorer";
import type { KeywordGapQuery } from "@/types/schemas/keyword-gap";

/** Exports every row the current filters match (up to the server cap), not just the visible page. */
export async function exportGap(
  projectId: string,
  query: KeywordGapQuery,
  format: "csv" | "excel" | "json" | "sheets",
) {
  const result = await exportKeywordGap({ data: { projectId, query } });
  if (!result) return;
  await exportRows({
    format,
    feature: "keyword_gap",
    filename: `keyword-gap-${result.run.targetDomain}`,
    headers: [
      "Keyword",
      "Type",
      "Volume",
      "Difficulty",
      "CPC",
      "Intent",
      "Best competitor",
      "Competitor position",
      "Winning URL",
      "Your position",
      "Competitors ranking",
      "Observed",
    ],
    rows: result.rows.map((row) => [
      row.keyword,
      row.kind,
      row.searchVolume,
      row.keywordDifficulty,
      row.cpc,
      row.intent,
      row.bestDomain,
      row.bestPosition,
      row.bestUrl,
      row.targetPosition,
      row.competitorCount,
      row.observedAt,
    ]),
  });
}
