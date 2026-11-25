import { expect, it, vi } from "vitest";
import { readAiSample, readSearchConsole } from "./firstReadSources";

const { getPerformance, explorePrompt } = vi.hoisted(() => ({
  getPerformance: vi.fn(),
  explorePrompt: vi.fn(),
}));

vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance },
}));
vi.mock("@/server/features/ai-search/services/promptExplorer", () => ({
  explorePrompt,
}));
vi.mock("@/server/features/domain/services/DomainService", () => ({
  DomainService: {},
}));
vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({ ProjectContextRepository: {} }),
);
vi.mock(
  "@/server/features/site-explorer/services/CompetitorExplorerService",
  () => ({ CompetitorExplorerService: {} }),
);
vi.mock("@/server/features/workspace/credentials", () => ({
  getWorkspaceMode: async () => "trial",
}));
vi.mock("@/server/lib/scrape", () => ({ readPages: vi.fn() }));

const scope = {
  projectId: "project",
  domain: "example.com",
  locationCode: 2840,
  languageCode: "en",
};
const row = (
  query: string,
  page: string,
  position: number,
  impressions: number,
) => ({
  keys: [query, page],
  position,
  impressions,
  clicks: 0,
});

it("uses the best page for each query and counts only this site's pages", async () => {
  getPerformance.mockResolvedValueOnce({
    siteUrl: "sc-domain:example.com",
    request: { startDate: "2026-10-01", endDate: "2026-10-28" },
    rows: [
      row("already ranks", "https://example.com/a", 15, 500),
      row("already ranks", "https://example.com/b", 7, 200),
      row("other site", "https://example.com.evil.example/", 10, 1000),
      row("real opportunity", "https://example.com/c", 8, 70),
    ],
  });
  const result = await readSearchConsole(scope, "sc-domain:example.com");
  expect(result?.finding).toMatchObject({
    subject: "real opportunity",
    metric: 70,
    relatedMetric: 8,
    page: "https://example.com/c",
    rangeStart: "2026-10-01",
    rangeEnd: "2026-10-28",
  });
});

it("skips failed answers and counts citations to the project domain in a two-prompt sample", async () => {
  explorePrompt
    .mockResolvedValueOnce({ results: [{ status: "error" }] })
    .mockResolvedValueOnce({
      fetchedAt: "2026-11-22T10:00:00Z",
      results: [
        {
          status: "success",
          text: "An answer with references",
          citations: [
            { url: "https://docs.example.com/a", domain: "docs.example.com" },
            {
              url: "https://example.com.evil.example/",
              domain: "example.com.evil.example",
            },
          ],
        },
      ],
    });

  const findings = await readAiSample(
    scope,
    ["one", "two", "three"],
    {
      organizationId: "org",
      userId: "user",
      userEmail: "user@example.com",
    },
    null,
  );
  expect(findings).toEqual([
    {
      kind: "ai_citations",
      subject: "two",
      metric: 1,
      relatedMetric: 2,
      page: "https://docs.example.com/a",
      observedAt: "2026-11-22T10:00:00Z",
    },
  ]);
  expect(explorePrompt).toHaveBeenCalledTimes(2);
});
