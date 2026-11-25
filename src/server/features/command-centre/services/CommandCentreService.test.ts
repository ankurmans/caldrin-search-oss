import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandCentreService } from "./CommandCentreService";

// The service only reads other features' stored data, so each source is a
// stub whose result a test can swap.
const source = vi.hoisted(() => ({
  opportunities: async (): Promise<unknown> => [],
  entries: [] as unknown[],
}));

vi.mock(
  "@/server/features/opportunities/services/OpportunityEngineService",
  () => ({ OpportunityEngineService: { list: () => source.opportunities() } }),
);
vi.mock("@/server/features/ledger/services/LedgerService", () => ({
  LedgerService: { listEntries: async () => source.entries },
}));
vi.mock("@/server/features/content/repositories/ContentRepository", () => ({
  ContentRepository: {
    listAssets: async () => [],
    getConnection: async () => null,
  },
}));
vi.mock("@/server/features/monitoring/services/MonitoringService", () => ({
  MonitoringService: { listAlerts: async () => ({ unread: 0 }) },
}));
vi.mock("@/server/features/ai-visibility/services/AiVisibilityService", () => ({
  AiVisibilityService: {
    getTracker: async () => ({ configured: false }),
    getIntelligence: async () => ({}),
  },
}));
vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: { getConfigSummaries: async () => [] } }),
);
vi.mock("@/server/features/dashboard/services/DashboardService", () => ({
  DashboardService: { getOverview: async () => ({ audit: null }) },
}));
vi.mock(
  "@/server/features/project-context/services/ProjectContextService",
  () => ({
    ProjectContextService: {
      getProjectContext: async () => ({ competitors: [] }),
    },
  }),
);

const DAY_MS = 86_400_000;
const input = { projectId: "p1", domain: "example.com" };

describe("CommandCentreService.get", () => {
  beforeEach(() => {
    source.opportunities = async () => [];
    source.entries = [];
  });

  it("leaves only the failing section empty when one source cannot be read", async () => {
    source.opportunities = async () => {
      throw new Error("read failed");
    };

    const result = await CommandCentreService.get(input);

    expect(result.opportunities).toBeNull();
    expect(result.execution).not.toBeNull();
    // Provider spend is never part of the dashboard payload.
    expect(result).not.toHaveProperty("spend");
  });

  it("counts a change as due for follow-up only once its measurement window has passed", async () => {
    const executed = (daysAgo: number) => ({
      status: "executed",
      finalDecision: null,
      executedAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
      measurementWindowDays: 14,
    });
    source.entries = [executed(30), executed(3)];

    const result = await CommandCentreService.get(input);

    expect(result.execution?.followUpsDue).toBe(1);
  });
});
