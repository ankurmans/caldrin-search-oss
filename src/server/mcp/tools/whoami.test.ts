import { beforeEach, describe, expect, it, vi } from "vitest";
import { whoamiTool } from "./whoami";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({ getTrialState: vi.fn() }));
vi.mock("@/server/features/workspace/trial", () => ({
  getTrialState: mocks.getTrialState,
}));

const context = makeToolContext();

beforeEach(() => {
  mocks.getTrialState.mockResolvedValue({ phase: "none" });
});

describe("whoami", () => {
  it("shows what is left of the free test run", async () => {
    mocks.getTrialState.mockResolvedValue({
      phase: "active",
      spentUsd: 0.5,
      budgetUsd: 2,
    });
    const result = await whoamiTool.handler({}, context);
    expect(result.structuredContent.trial).toBe("active");
    expect(textContent(result)).toContain("$1.50 left of $2.00");
  });

  it("says when the free test run is used", async () => {
    mocks.getTrialState.mockResolvedValue({
      phase: "ended",
      spentUsd: 2,
      budgetUsd: 2,
    });
    const result = await whoamiTool.handler({}, context);
    expect(textContent(result)).toContain("used");
  });
});
