import { isLocalScanActive, LocalScanStatus } from "@/shared/local-seo";
import { LocalSeoRepository as repo } from "../repositories/LocalSeoRepository";
import { LocalSeoService } from "./LocalSeoService";

/**
 * Every saved location of a project side by side: the newest finished check's
 * coverage per location, from saved results only. It starts nothing and uses
 * no credits.
 */
export async function localOverview(projectId: string) {
  const trackers = await repo.listTrackers(projectId);
  const locations = await Promise.all(
    trackers.map(async ({ id }) => {
      const { tracker, keywords, checks, scans } =
        await LocalSeoService.getTracker(projectId, id);
      const latest = checks.find(
        (check) =>
          !isLocalScanActive(check.status) &&
          check.status !== LocalScanStatus.Failed,
      );
      const summaries = scans
        .filter((scan) => scan.checkId === latest?.id && scan.summary)
        .map((scan) => ({
          keyword: keywords.find((k) => k.id === scan.keywordId)?.keyword,
          ...scan.summary!,
        }));
      const found = summaries.filter((s) => s.averageRank !== null);
      return {
        trackerId: tracker.id,
        title: tracker.title,
        address: tracker.address,
        gridSize: tracker.gridSize,
        spacingKm: tracker.spacingKm,
        schedule: tracker.scheduleInterval,
        nextCheckAt: tracker.nextCheckAt,
        lastSkipReason: tracker.lastSkipReason,
        keywords: keywords.length,
        latestCheckAt: latest?.completedAt ?? latest?.createdAt ?? null,
        // Share of grid points where the business is in the top three,
        // averaged over the keywords with at least one finished point.
        top3Percent: summaries.length
          ? Math.round(
              summaries.reduce((n, s) => n + (s.top3Percent ?? 0), 0) /
                summaries.length,
            )
          : null,
        averageRank: found.length
          ? Number(
              (
                found.reduce((n, s) => n + (s.averageRank ?? 0), 0) /
                found.length
              ).toFixed(1),
            )
          : null,
        byKeyword: summaries.map((s) => ({
          keyword: s.keyword ?? null,
          top3Percent: s.top3Percent,
          averageRank: s.averageRank,
          pointsFound: s.found,
          pointsChecked: s.completed,
        })),
      };
    }),
  );
  return {
    locations,
    notes: [
      "Rank is where the saved listing appears in Google Maps at each grid point, not a ranking for the whole city. A point that found nothing is not a rank of zero.",
    ],
  };
}
