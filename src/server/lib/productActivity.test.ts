import { afterEach, expect, it, vi } from "vitest";
import { recordProductActivity } from "./productActivity";

const consent = vi.hoisted(() => ({ optedOut: vi.fn() }));
vi.mock("@/db", () => ({ withPgClient: (run: () => unknown) => run() }));
vi.mock("@/server/auth/repositories/AuthRepository", () => ({
  AuthRepository: { isAnalyticsOptedOut: consent.optedOut },
}));

afterEach(() => vi.restoreAllMocks());

it("writes action metadata and honors analytics opt-out", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const activity = {
    source: "app" as const,
    action: "runAiVisibilityCheck",
    userId: "user",
    organizationId: "org",
    projectId: "project",
    outcome: "success" as const,
    durationMs: 30,
  };

  consent.optedOut.mockResolvedValue(false);
  await recordProductActivity(activity);
  consent.optedOut.mockResolvedValue(true);
  await recordProductActivity(activity);

  expect(log).toHaveBeenCalledExactlyOnceWith("[product_activity]", activity);
});
