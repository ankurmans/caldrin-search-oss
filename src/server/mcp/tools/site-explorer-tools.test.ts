import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runKeywordGapTool } from "./site-explorer-tools";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  estimate: vi.fn(),
  run: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock(
  "@/server/features/site-explorer/services/KeywordGapExplorerService",
  () => ({
    KeywordGapExplorerService: { estimate: mocks.estimate, run: mocks.run },
  }),
);
vi.mock("@/server/features/domain/services/DomainService", () => ({
  DomainService: {},
}));
vi.mock(
  "@/server/features/site-explorer/services/CompetitorExplorerService",
  () => ({ CompetitorExplorerService: {} }),
);

const projectId = "11111111-1111-4111-8111-111111111111";

function call(args: Record<string, unknown>, role = "owner") {
  const parsed = z
    .object(runKeywordGapTool.config.inputSchema)
    .parse({ projectId, ...args });
  return runKeywordGapTool.handler(parsed, makeToolContext({ role }));
}

describe("run_keyword_gap", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({ id: projectId });
    mocks.estimate.mockResolvedValue({
      available: true,
      reason: null,
      estimatedUsd: 0.12,
      providerReads: 3,
      competitors: ["a.test"],
      includeOutranked: false,
      ranToday: null,
    });
  });

  it("only previews the cost until a ceiling is passed", async () => {
    const result = await call({});
    expect(textContent(result)).toContain("Nothing was fetched");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("refuses a ceiling below the fresh estimate without running", async () => {
    const result = await call({ maxCostUsd: 0.05 });
    expect(textContent(result)).toContain("above maxCostUsd");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("runs once the ceiling covers the estimate", async () => {
    mocks.run.mockResolvedValue({
      runId: "r1",
      rowCount: 40,
      costUsd: 0.1,
      partial: false,
    });
    const result = await call({ maxCostUsd: 0.2 });
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(textContent(result)).toContain("Stored 40 keywords");
  });
});
