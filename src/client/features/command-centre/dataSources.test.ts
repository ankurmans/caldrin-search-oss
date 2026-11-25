import { describe, expect, it } from "vitest";
import { buildDataStatus } from "./dataSources";
import type { CommandCentreData } from "./helpers";

const DAY_MS = 86_400_000;
const ago = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fixture: only the fields buildDataStatus reads
const healthy: Parameters<typeof buildDataStatus>[0]["data"] = {
  ai: { configured: true, lastRunAt: ago(1), lastRunStatus: "completed" },
  rank: { trackers: 1, keywords: 12, lastCheckedAt: ago(2) },
  opportunities: { lastObservedAt: ago(2) },
  audit: { status: "completed", pagesCrawled: 40 },
} as CommandCentreData;

const state = (status: ReturnType<typeof buildDataStatus>, id: string) =>
  status.sources.find((source) => source.id === id)?.state;

describe("dashboard data status", () => {
  it("reports nothing to review when every source is connected and recent", () => {
    expect(
      buildDataStatus({ gscConnected: true, data: healthy }).needsAttention,
    ).toBe(0);
  });

  it("names a missing connection and the step that fixes it", () => {
    const status = buildDataStatus({ gscConnected: false, data: healthy });
    expect(status.sources[0]).toMatchObject({
      state: "missing",
      action: "connect_gsc",
    });
    expect(status.needsAttention).toBe(1);
  });

  it("calls an old reading stale and a failed run failed, without hiding either", () => {
    const status = buildDataStatus({
      gscConnected: true,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fixture: only the fields buildDataStatus reads
      data: {
        ...healthy,
        ai: { configured: true, lastRunAt: ago(2), lastRunStatus: "failed" },
        rank: { trackers: 1, keywords: 12, lastCheckedAt: ago(30) },
        opportunities: { lastObservedAt: ago(30) },
      } as CommandCentreData,
    });
    expect(state(status, "ai")).toBe("failed");
    expect(state(status, "rank")).toBe("stale");
    expect(state(status, "opportunities")).toBe("stale");
    expect(status.needsAttention).toBe(3);
  });

  it("reports a source that could not be read as failed, never as healthy", () => {
    const status = buildDataStatus({
      gscConnected: true,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fixture: only the fields buildDataStatus reads
      data: {
        ...healthy,
        ai: null,
        rank: null,
        opportunities: null,
        audit: null,
      } as CommandCentreData,
    });
    expect(state(status, "ai")).toBe("failed");
    expect(state(status, "rank")).toBe("failed");
    expect(state(status, "opportunities")).toBe("failed");
    expect(state(status, "audit")).toBe("missing");
  });
});
