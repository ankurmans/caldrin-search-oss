import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RenderingPolicy from "@/server/lib/audit/rendering-policy";

const mocks = vi.hoisted(() => {
  const workflowCreate = vi.fn<(options: object) => Promise<void>>();
  return {
    workflowCreate,
    renderingAllowed: vi.fn(),
    getWorkspaceMode: vi.fn(),
    env: {
      SITE_AUDIT_WORKFLOW: {
        create: workflowCreate,
        get: vi.fn().mockRejectedValue(new Error("No instance")),
      },
    } as Record<string, unknown>,
  };
});

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
// The check is mocked; the message it comes with is the real one, which
// reads AUTH_MODE from the env above.
vi.mock("@/server/lib/audit/rendering-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof RenderingPolicy>()),
  isAuditRenderingAllowed: mocks.renderingAllowed,
}));
vi.mock("@/server/features/workspace/credentials", () => ({
  getWorkspaceMode: mocks.getWorkspaceMode,
}));
vi.mock("@/server/lib/audit/url-policy", () => ({
  normalizeAndValidateStartUrl: async (url: string) => url,
}));
vi.mock("@/server/features/audit/services/CrawlerCredentialService", () => ({
  CrawlerCredentialService: {
    resolveCrawlerAccess: vi.fn().mockResolvedValue(null),
    openCrawlerAccess: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: {
    createAudit: vi.fn(),
    getAuditUsageForOrganization: vi
      .fn()
      .mockResolvedValue({ runningCount: 1, capacityUnits: 0 }),
  },
}));
vi.mock("@/server/features/audit/AuditScratchpad", () => ({}));
vi.mock("@/server/lib/audit/progress-kv", () => ({ AuditProgressKV: {} }));

import { AuditService } from "@/server/features/audit/services/AuditService";

const renderedAudit = {
  actorUserId: "user-1",
  billingCustomer: {
    userId: "user-1",
    userEmail: "user@example.com",
    organizationId: "org-1",
  },
  projectId: "project-1",
  startUrl: "https://example.com/",
  maxPages: 100,
  renderJavaScript: true,
  limitTier: "paid" as const,
};

describe("rendered audit start", () => {
  beforeEach(() => {
    mocks.renderingAllowed.mockResolvedValue(true);
    mocks.getWorkspaceMode.mockResolvedValue("byok");
  });

  it("rejects rendering where the deployment cannot provide it, saying why", async () => {
    mocks.renderingAllowed.mockResolvedValue(false);
    const error = await AuditService.startAudit(renderedAudit).catch(
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({ code: "AUDIT_RENDERING_UNAVAILABLE" });
    // MCP clients see this message as the tool's answer.
    expect(String(error)).toContain("TINYFISH_API_KEY");
    expect(mocks.workflowCreate).not.toHaveBeenCalled();
  });

  it("keeps rendering out of the free test run", async () => {
    mocks.getWorkspaceMode.mockResolvedValue("trial");
    await expect(AuditService.startAudit(renderedAudit)).rejects.toMatchObject({
      code: "AUDIT_RENDERING_UNAVAILABLE",
    });
    expect(mocks.workflowCreate).not.toHaveBeenCalled();
  });

  it("starts a rendered audit for a workspace on its own keys", async () => {
    await AuditService.startAudit(renderedAudit);
    expect(mocks.workflowCreate).toHaveBeenCalledOnce();
  });
});
