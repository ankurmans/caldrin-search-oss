import { exportRows } from "@/client/lib/exportRows";
import type {
  exportLinkGap,
  getLinkGap,
} from "@/serverFunctions/link-acquisition";
import { exportLinkGap as fetchExport } from "@/serverFunctions/link-acquisition";
import type { LinkGapQuery } from "@/types/schemas/link-acquisition";
import {
  LINK_RECOMMENDATION_LABELS,
  type LinkRecommendation,
} from "@/shared/link-acquisition";

export type LinkGapData = NonNullable<Awaited<ReturnType<typeof getLinkGap>>>;
export type LinkGapRow = LinkGapData["rows"][number];
type LinkGapExport = NonNullable<Awaited<ReturnType<typeof exportLinkGap>>>;

export const linkGapKeys = {
  table: (projectId: string) => ["linkGap", projectId] as const,
  runs: (projectId: string) => ["linkGapRuns", projectId] as const,
  settings: (projectId: string) => ["linkQualification", projectId] as const,
};

export const RECOMMENDATION_VARIANT: Record<
  LinkRecommendation,
  "success" | "info" | "outline"
> = { pursue: "success", review: "info", skip: "outline" };

export const recommendationLabel = (value: LinkRecommendation) =>
  LINK_RECOMMENDATION_LABELS[value];

/** Up to the server cap of rows matching the current filters, not just the page. */
export async function exportGap(
  projectId: string,
  query: LinkGapQuery,
  format: "csv" | "excel" | "json" | "sheets",
) {
  const result: LinkGapExport | null = await fetchExport({
    data: { projectId, query },
  });
  if (!result) return;
  await exportRows({
    format,
    feature: "link_gap",
    filename: `link-gap-${result.run.targetDomain}`,
    headers: [
      "Referring domain",
      "Competitors linked",
      "Competitors",
      "Domain Rank (0-1000)",
      "Spam score",
      "First seen",
      "Score",
      "Recommendation",
      "Why found",
      "Why relevant",
      "Why realistic",
      "Next action",
      "Confidence",
      "Limitations",
      "Exact linking pages",
      "Competitor destination URLs",
      "Observed",
    ],
    rows: result.rows.map((row) => [
      row.referringDomain,
      row.competitorCount,
      row.competitors.map((c) => c.competitorDomain).join("; "),
      row.domainRank,
      row.spamScore,
      row.firstSeen,
      row.qualification.score,
      row.qualification.recommendation,
      row.qualification.whyFound,
      row.qualification.whyRelevant,
      row.qualification.whyRealistic,
      row.qualification.nextAction,
      row.qualification.confidence,
      row.qualification.limitations.join(" | "),
      row.evidence.map((item) => item.urlFrom).join("; "),
      row.qualification.competitorDestinations.join("; "),
      row.observedAt,
    ]),
  });
}
