import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { MonitoringService } from "@/server/features/monitoring/services/MonitoringService";
import { OpportunityEngineService } from "@/server/features/opportunities/services/OpportunityEngineService";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { AiVisibilityService } from "@/server/features/ai-visibility/services/AiVisibilityService";

const DAY_MS = 86_400_000;
const NEXT_ACTION_LIMIT = 5;

// One source that cannot be read leaves its own pulse unavailable; the rest of
// the page still loads. Nothing here calls a paid provider: every read is of
// stored observations.
async function readOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

function latest(values: (string | null)[]): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (value !== null && (best === null || value > best)) best = value;
  }
  return best;
}

async function loadOpportunities(projectId: string) {
  const rows = await OpportunityEngineService.list(projectId);
  const actionable = rows.filter(
    (row) => row.recommendedAction !== "no_action" && !row.noLongerFound,
  );
  const open = actionable.filter((row) => row.status === "open");
  const lastObservedAt = latest(rows.map((row) => row.observedAt));
  return {
    total: rows.length,
    open: open.length,
    inProgress: actionable.filter((row) => row.status === "briefed").length,
    demo: actionable.filter((row) => row.dataSource === "simulated").length,
    aiGaps: open.filter((row) => row.dataSource === "ai_visibility").length,
    competitorGaps: open.filter((row) => row.dataSource === "competitor")
      .length,
    technical: open.filter((row) => row.recommendedAction === "technical_fix")
      .length,
    lastObservedAt,
    // The list is already ordered by priority, then impressions.
    next: open.slice(0, NEXT_ACTION_LIMIT).map((row) => ({
      id: row.id,
      query: row.query,
      pageUrl: row.pageUrl,
      action: row.recommendedAction,
      priority: row.priority,
      priorityReason: row.priorityReason,
      reason: row.reason,
      dataSource: row.dataSource,
      observedAt: row.observedAt,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      impressions: row.impressions,
      clicks: row.clicks,
      position: row.position,
      evidenceCount: row.evidenceCount,
    })),
  };
}

async function loadExecution(projectId: string) {
  const [entries, assets, alerts] = await Promise.all([
    LedgerService.listEntries(projectId, { limit: 200 }),
    ContentRepository.listAssets(projectId),
    MonitoringService.listAlerts(projectId, { limit: 1, offset: 0 }),
  ]);
  const now = Date.now();
  const followUpsDue = entries.filter(
    (entry) =>
      entry.status === "executed" &&
      entry.finalDecision === null &&
      entry.executedAt !== null &&
      entry.measurementWindowDays !== null &&
      Date.parse(entry.executedAt) + entry.measurementWindowDays * DAY_MS <=
        now,
  ).length;
  const count = (status: string) =>
    entries.filter((entry) => entry.status === status).length;
  const recent = entries
    .filter((entry) => entry.status !== "proposed")
    .slice(0, 3)
    .map((entry) => ({
      id: entry.id,
      proposedAction: entry.proposedAction,
      status: entry.status,
      at: entry.executedAt ?? entry.updatedAt,
    }));
  return {
    pendingApprovals: count("proposed"),
    approvedNotRun: count("approved"),
    failed: count("failed"),
    completed: count("executed"),
    followUpsDue,
    draftAssets: assets.filter((asset) => asset.status === "draft").length,
    approvedAssets: assets.filter((asset) => asset.status === "approved")
      .length,
    unreadAlerts: alerts.unread,
    recent,
  };
}

async function loadAiPulse(projectId: string) {
  const tracker = await AiVisibilityService.getTracker({ projectId });
  if (!tracker.configured || !tracker.tracker)
    return { configured: false as const };
  const intelligence = await AiVisibilityService.getIntelligence({
    projectId,
    days: 28,
    branded: "all",
  });
  const trackedPrompts = tracker.prompts.filter(
    (prompt) => !prompt.archived && !prompt.paused,
  ).length;
  const lastRun = tracker.recentRuns[0] ?? null;
  const target = intelligence.target;
  const ranked = intelligence.leaderboard.filter(
    (brand) => brand.visibility !== null,
  );
  ranked.sort((a, b) => (b.visibility ?? 0) - (a.visibility ?? 0));
  return {
    configured: true as const,
    trackedPrompts,
    engines: intelligence.coverage.engines,
    answered: intelligence.coverage.answered,
    contributingRuns: intelligence.coverage.contributingRuns,
    repeatRunLevel: intelligence.repeatRuns.level,
    visibility: target?.visibility ?? null,
    mention: target?.mention ?? null,
    citedAnswers: target?.citedAnswers ?? null,
    // Over the answers a model has read, so unread ones never count as "not
    // recommended". Null until any have been read.
    recommended:
      target?.sentiment && target.sentiment.classified > 0
        ? {
            numerator: Math.min(
              target.recommendation.numerator,
              target.sentiment.classified,
            ),
            denominator: target.sentiment.classified,
          }
        : null,
    brandsCompared: intelligence.brandsCompared,
    rank: target ? ranked.findIndex((brand) => brand.own) + 1 || null : null,
    // The change is only present when the earlier window measured the same
    // prompt set on the same engines.
    change: target?.change ?? null,
    comparable: intelligence.comparison.comparable,
    comparisonNote: intelligence.comparison.reason,
    observedWindow: intelligence.observedWindow,
    lastRunAt: lastRun?.completedAt ?? lastRun?.createdAt ?? null,
    lastRunStatus: lastRun?.status ?? null,
    nextCheckAt: tracker.tracker.nextCheckAt,
    warnings: intelligence.warnings,
  };
}

async function loadRankPulse(projectId: string) {
  const configs = await RankTrackingRepository.getConfigSummaries(projectId);
  const lastCheckedAt = latest(
    configs.map((config) => config.lastRunCompletedAt),
  );
  return {
    trackers: configs.length,
    keywords: configs.reduce((sum, config) => sum + config.keywordCount, 0),
    lastCheckedAt,
  };
}

async function get(input: { projectId: string; domain: string | null }) {
  const [opportunities, execution, ai, rank, site, context, store] =
    await Promise.all([
      readOrNull(() => loadOpportunities(input.projectId)),
      readOrNull(() => loadExecution(input.projectId)),
      readOrNull(() => loadAiPulse(input.projectId)),
      readOrNull(() => loadRankPulse(input.projectId)),
      readOrNull(() => DashboardService.getOverview(input)),
      readOrNull(() =>
        ProjectContextService.getProjectContext(input.projectId),
      ),
      readOrNull(() => ContentRepository.getConnection(input.projectId)),
    ]);
  return {
    generatedAt: new Date().toISOString(),
    opportunities,
    execution,
    ai,
    rank,
    audit: site?.audit ?? null,
    auditRead: site !== null,
    competitors: context?.competitors.length ?? null,
    // The store connection's mode ("live" or "simulated"), or null.
    store: store?.mode ?? null,
  };
}

export const CommandCentreService = { get };
