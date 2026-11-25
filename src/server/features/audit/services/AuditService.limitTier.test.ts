import { beforeEach, describe, expect, it, vi } from "vitest";

const { getWorkspaceModeMock } = vi.hoisted(() => ({
  getWorkspaceModeMock: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/workspace/credentials", () => ({
  getWorkspaceMode: getWorkspaceModeMock,
}));
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: {},
}));
vi.mock("@/server/features/audit/AuditScratchpad", () => ({
  getAuditScratchpad: vi.fn(),
}));
vi.mock("@/server/lib/audit/progress-kv", () => ({ AuditProgressKV: {} }));

import { AuditService } from "@/server/features/audit/services/AuditService";

const customer = {
  organizationId: "org-1",
  userEmail: "user@example.com",
  userId: "user-1",
};

describe("resolveAuditLimitTier", () => {
  beforeEach(() => {
    getWorkspaceModeMock.mockResolvedValue("byok");
  });

  it("keeps a trial workspace on the free audit tier", async () => {
    getWorkspaceModeMock.mockResolvedValue("trial");

    await expect(AuditService.resolveAuditLimitTier(customer)).resolves.toBe(
      "free",
    );
  });

  it.each(["byok", "cloud"])(
    "uses the uncapped tier for a %s workspace",
    async (mode) => {
      getWorkspaceModeMock.mockResolvedValue(mode);

      await expect(AuditService.resolveAuditLimitTier(customer)).resolves.toBe(
        "self_hosted",
      );
    },
  );
});
