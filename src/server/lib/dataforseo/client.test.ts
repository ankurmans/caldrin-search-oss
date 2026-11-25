import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertTrialBudgetMock, recordTrialSpendMock } = vi.hoisted(() => ({
  assertTrialBudgetMock: vi.fn(),
  recordTrialSpendMock: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
}));

vi.mock("@/server/features/workspace/trial", () => ({
  assertTrialBudget: assertTrialBudgetMock,
  recordTrialSpend: recordTrialSpendMock,
}));

vi.mock("@/server/lib/posthog", () => ({
  captureServerEvent: vi.fn(),
}));

// Mock every section module the client wraps so meterDataforseoCall's
// `execute()` resolves to a controllable fixture.
vi.mock("@/server/lib/dataforseo/labs", () => ({
  fetchRelatedKeywords: vi.fn(),
  fetchKeywordSuggestions: vi.fn(),
  fetchKeywordIdeas: vi.fn(),
  fetchDomainRankOverview: vi.fn(),
  fetchHistoricalRankOverview: vi.fn(),
  fetchRankedKeywords: vi.fn(),
  fetchRelevantPages: vi.fn(),
  fetchKeywordOverview: vi.fn(),
  fetchSerpCompetitors: vi.fn(),
  fetchDomainIntersection: vi.fn(),
  fetchCompetitorsDomain: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo/serp", () => ({
  postSerpReadTasks: vi.fn(),
  SERP_READS_PER_QUERY: 3,
  postRankCheckTasks: vi.fn(),
  fetchLocalSerp: vi.fn(),
  postLocalSerpTasks: vi.fn(),
  clampSerpDepth: (depth: number) => depth,
  SERP_ANALYSIS_DEPTH: 20,
}));
vi.mock("@/server/lib/dataforseo/business", () => ({
  fetchBusinessListingsSearch: vi.fn(),
  fetchQuestionsAnswers: vi.fn(),
  fetchMyBusinessInfo: vi.fn(),
  postGoogleReviewsTask: vi.fn(),
  postMyBusinessUpdatesTask: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo/google-ads", () => ({
  fetchAdsKeywordIdeas: vi.fn(),
  fetchAdsSearchVolume: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo/backlinks", () => ({
  fetchBacklinksSummary: vi.fn(),
  fetchBacklinksRows: vi.fn(),
  fetchBacklinksAnchors: vi.fn(),
  fetchReferringDomains: vi.fn(),
  fetchDomainPagesSummary: vi.fn(),
  fetchBacklinksHistory: vi.fn(),
  BACKLINKS_DEFAULT_LIMIT: 100,
}));
vi.mock("@/server/lib/dataforseo/backlinksIntersection", () => ({
  fetchBacklinksDomainIntersection: vi.fn(),
  LINK_GAP_DEFAULT_LIMIT: 100,
}));
vi.mock("@/server/lib/dataforseo/lighthouse", () => ({
  fetchLighthouseResult: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo/ai", () => ({
  fetchLlmMentionsSearch: vi.fn(),
  fetchLlmAggregatedMetrics: vi.fn(),
  fetchLlmTopPages: vi.fn(),
  fetchLlmTopDomains: vi.fn(),
  fetchAiKeywordVolume: vi.fn(),
  AI_KEYWORD_VOLUME_MAX: 1000,
  fetchLlmCrossAggregatedMetrics: vi.fn(),
  resolveLlmMentionsLimit: (limit?: number) => limit ?? 100,
}));

vi.mock("@/server/lib/dataforseo/ai-tracking", () => ({
  postAiTrackingTasks: vi.fn(),
  fetchAiTrackingLiveAnswer: vi.fn(),
}));

import { createDataforseoClient } from "@/server/lib/dataforseo/client";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import { DataforseoChargedTaskError } from "@/server/lib/dataforseo/envelope";
import { AppError } from "@/server/lib/errors";
import { fetchBacklinksSummary } from "@/server/lib/dataforseo/backlinks";
import { postSerpReadTasks } from "@/server/lib/dataforseo/serp";
import { postAiTrackingTasks } from "@/server/lib/dataforseo/ai-tracking";

const customer = {
  organizationId: "org_123",
  userId: "user_123",
  userEmail: "alice@example.com",
};

const backlinksInput = { target: "example.com" };
const backlinksPath = ["v3", "backlinks", "summary", "live"];
const RAW_COST = 0.02;

function mockDataforseoResult(costUsd: number) {
  vi.mocked(fetchBacklinksSummary).mockResolvedValue({
    data: { rank: 42 },
    billing: { costUsd, path: backlinksPath },
  });
}

beforeEach(() => {
  assertTrialBudgetMock.mockResolvedValue(undefined);
  recordTrialSpendMock.mockResolvedValue(undefined);
});

describe("meterDataforseoCall", () => {
  it("checks the estimate first, then records what DataForSEO billed", async () => {
    mockDataforseoResult(RAW_COST);

    const result =
      await createDataforseoClient(customer).backlinks.summary(backlinksInput);

    expect(result).toEqual({ rank: 42 });
    expect(assertTrialBudgetMock).toHaveBeenCalledWith(
      "org_123",
      dataforseoPricing.backlinks.summary(backlinksInput),
    );
    expect(recordTrialSpendMock).toHaveBeenCalledWith("org_123", RAW_COST);
  });

  it("never calls the provider when the trial budget is spent", async () => {
    assertTrialBudgetMock.mockRejectedValue(new AppError("TRIAL_ENDED"));
    mockDataforseoResult(RAW_COST);

    await expect(
      createDataforseoClient(customer).backlinks.summary(backlinksInput),
    ).rejects.toMatchObject({ code: "TRIAL_ENDED" });

    expect(fetchBacklinksSummary).not.toHaveBeenCalled();
    expect(recordTrialSpendMock).not.toHaveBeenCalled();
  });

  it("records a charged task failure at its cost before rethrowing", async () => {
    vi.mocked(fetchBacklinksSummary).mockRejectedValue(
      new DataforseoChargedTaskError("DataForSEO task failed", {
        costUsd: RAW_COST,
        path: backlinksPath,
      }),
    );

    await expect(
      createDataforseoClient(customer).backlinks.summary(backlinksInput),
    ).rejects.toThrow("DataForSEO task failed");

    expect(recordTrialSpendMock).toHaveBeenCalledWith("org_123", RAW_COST);
  });

  it("records nothing for an unbilled invalid-field failure, logs the field but not its value, and throws VALIDATION_ERROR", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fetchBacklinksSummary).mockRejectedValue(
      new DataforseoChargedTaskError(
        `Invalid Field: 'target'. (sent target="customer.example")`,
        { costUsd: 0, path: backlinksPath },
        true,
      ),
    );

    await expect(
      createDataforseoClient(customer).backlinks.summary(backlinksInput),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(recordTrialSpendMock).toHaveBeenCalledWith("org_123", 0);
    expect(warn).toHaveBeenCalledWith("dataforseo.invalid-field", {
      event: "dataforseo.invalid-field",
      path: "/v3/backlinks/summary/live",
      field: "target",
    });
    warn.mockRestore();
  });

  it("records nothing when the provider call fails before billing", async () => {
    vi.mocked(fetchBacklinksSummary).mockRejectedValue(
      new AppError("UPSTREAM_UNAVAILABLE", "DataForSEO timed out"),
    );

    await expect(
      createDataforseoClient(customer).backlinks.summary(backlinksInput),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });

    expect(recordTrialSpendMock).toHaveBeenCalledWith("org_123", 0);
  });
});

describe("AI visibility queued posts", () => {
  const input = {
    engine: "chatgpt" as const,
    locationCode: 2840,
    languageCode: "en",
    tasks: [
      { tag: "a", prompt: "Which SEO tools?" },
      { tag: "b", prompt: "Best rank tracker?" },
    ],
  };

  it("records the posted cost and returns the posted tasks", async () => {
    const data = [
      { tag: "a", taskId: "task-a", costUsd: 0.0011 },
      { tag: "b", taskId: "task-b", costUsd: 0.0011 },
    ];
    vi.mocked(postAiTrackingTasks).mockResolvedValue({
      data,
      billing: { costUsd: 0.0022, path: ["task_post"] },
    });

    const posted =
      await createDataforseoClient(customer).aiSearch.trackingTaskPost(input);

    expect(posted).toEqual(data);
    expect(recordTrialSpendMock).toHaveBeenCalledWith("org_123", 0.0022);
  });

  it("records nothing when the post fails", async () => {
    vi.mocked(postAiTrackingTasks).mockRejectedValue(
      new AppError("UPSTREAM_UNAVAILABLE"),
    );

    await expect(
      createDataforseoClient(customer).aiSearch.trackingTaskPost(input),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });

    expect(recordTrialSpendMock).not.toHaveBeenCalled();
  });
});

describe("readsTaskPostBatch", () => {
  const input = {
    keyword: "running shoes",
    locationCode: 2840,
    languageCode: "en",
    device: "desktop" as const,
    depth: 10,
  };
  const billed = {
    data: ["task-1", "task-2", "task-3"],
    billing: {
      costUsd: 0.001,
      path: ["v3", "serp", "google", "organic", "task_post"],
    },
  };

  it("checks the summed estimate once and records the billed calls once", async () => {
    vi.mocked(postSerpReadTasks)
      .mockResolvedValueOnce(billed)
      .mockRejectedValueOnce(
        new AppError("UPSTREAM_UNAVAILABLE", "DataForSEO timed out"),
      )
      .mockResolvedValueOnce(billed);

    const settled = await createDataforseoClient(
      customer,
    ).serp.readsTaskPostBatch([input, input, input]);

    expect(settled.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
    expect(assertTrialBudgetMock).toHaveBeenCalledExactlyOnceWith(
      "org_123",
      3 * dataforseoPricing.serp.readsTaskPost(input),
    );
    expect(recordTrialSpendMock).toHaveBeenCalledExactlyOnceWith(
      "org_123",
      0.002,
    );
  });
});
