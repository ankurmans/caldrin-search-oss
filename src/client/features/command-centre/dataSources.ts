import { isStale } from "./helpers";
import type { CommandCentreData } from "./helpers";

export type SourceState = "ok" | "stale" | "missing" | "failed";

export type SourceStatus = {
  id: "gsc" | "ai" | "rank" | "opportunities" | "audit";
  label: string;
  state: SourceState;
  /** When the source last delivered, if it ever has. */
  at: string | null;
  detail: string;
  /** The step that fixes it, when there is one. */
  action:
    | "connect_gsc"
    | "set_up_ai"
    | "set_up_rank"
    | "run_analysis"
    | "run_audit"
    | null;
};

export type DataStatus = {
  sources: SourceStatus[];
  needsAttention: number;
};

type Input = {
  gscConnected: boolean;
  data: Pick<CommandCentreData, "ai" | "rank" | "opportunities" | "audit">;
};

const UNREADABLE = "Could not be read just now. Reload to try again.";

/**
 * One reading per source the dashboard depends on, so a missing connection, a
 * failed run and an old reading each say what they are. Nothing here calls a
 * provider: it only describes what is already stored.
 */
export function buildDataStatus({ gscConnected, data }: Input): DataStatus {
  const { ai, rank, opportunities, audit } = data;
  const sources: SourceStatus[] = [
    gscConnected
      ? {
          id: "gsc",
          label: "Search Console",
          state: "ok",
          at: null,
          detail: "Connected. Read live; Google reports 2–3 days behind.",
          action: null,
        }
      : {
          id: "gsc",
          label: "Search Console",
          state: "missing",
          at: null,
          detail: "Not connected, so there are no clicks or impressions.",
          action: "connect_gsc",
        },
    aiSource(ai),
    rankSource(rank),
    opportunitySource(opportunities),
    auditSource(audit),
  ];
  return {
    sources,
    needsAttention: sources.filter((source) => source.state !== "ok").length,
  };
}

function aiSource(ai: CommandCentreData["ai"]): SourceStatus {
  const base = { id: "ai", label: "AI answers" } as const;
  if (ai === null)
    return {
      ...base,
      state: "failed",
      at: null,
      detail: UNREADABLE,
      action: null,
    };
  if (!ai.configured)
    return {
      ...base,
      state: "missing",
      at: null,
      detail: "No prompts are tracked yet.",
      action: "set_up_ai",
    };
  if (ai.lastRunStatus === "failed")
    return {
      ...base,
      state: "failed",
      at: ai.lastRunAt,
      detail: "The last run failed. The numbers shown come from earlier runs.",
      action: null,
    };
  if (!ai.lastRunAt)
    return {
      ...base,
      state: "missing",
      at: null,
      detail: "Prompts are set up but no run has finished yet.",
      action: null,
    };
  const stale = isStale(ai.lastRunAt);
  return {
    ...base,
    state: stale ? "stale" : "ok",
    at: ai.lastRunAt,
    detail: stale
      ? "Last run is more than a week old."
      : "Collected on schedule.",
    action: null,
  };
}

function rankSource(rank: CommandCentreData["rank"]): SourceStatus {
  const base = { id: "rank", label: "Rank tracking" } as const;
  if (rank === null)
    return {
      ...base,
      state: "failed",
      at: null,
      detail: UNREADABLE,
      action: null,
    };
  if (rank.trackers === 0)
    return {
      ...base,
      state: "missing",
      at: null,
      detail: "Not set up.",
      action: "set_up_rank",
    };
  if (!rank.lastCheckedAt)
    return {
      ...base,
      state: "missing",
      at: null,
      detail: "Set up, but no check has completed yet.",
      action: null,
    };
  const stale = isStale(rank.lastCheckedAt);
  return {
    ...base,
    state: stale ? "stale" : "ok",
    at: rank.lastCheckedAt,
    detail: stale
      ? `Last check is more than a week old (${rank.keywords} keywords).`
      : `${rank.keywords} keywords tracked.`,
    action: null,
  };
}

function opportunitySource(
  opportunities: CommandCentreData["opportunities"],
): SourceStatus {
  const base = { id: "opportunities", label: "Opportunity analysis" } as const;
  if (opportunities === null)
    return {
      ...base,
      state: "failed",
      at: null,
      detail: UNREADABLE,
      action: null,
    };
  if (!opportunities.lastObservedAt)
    return {
      ...base,
      state: "missing",
      at: null,
      detail: "Analysis has not been run.",
      action: "run_analysis",
    };
  const stale = isStale(opportunities.lastObservedAt);
  return {
    ...base,
    state: stale ? "stale" : "ok",
    at: opportunities.lastObservedAt,
    detail: stale
      ? "Findings are more than a week old."
      : "Findings are up to date.",
    action: stale ? "run_analysis" : null,
  };
}

function auditSource(audit: CommandCentreData["audit"]): SourceStatus {
  const base = { id: "audit", label: "Site audit" } as const;
  if (!audit)
    return {
      ...base,
      state: "missing",
      at: null,
      detail: "No crawl has been run.",
      action: "run_audit",
    };
  if (audit.status === "failed")
    return {
      ...base,
      state: "failed",
      at: null,
      detail: "The last crawl failed.",
      action: "run_audit",
    };
  return {
    ...base,
    state: "ok",
    at: null,
    detail:
      audit.status === "running"
        ? "A crawl is running."
        : `${audit.pagesCrawled} pages crawled.`,
    action: null,
  };
}
