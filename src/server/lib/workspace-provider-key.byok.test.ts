import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  organizationId: null as string | null,
  credential: null as { apiKey: string } | null,
}));
// The export's vitest setup stubs this resolver for transport tests.
vi.unmock("@/server/lib/workspace-provider-key");
vi.mock("@/server/lib/workspace-scope", () => ({
  currentWorkspaceId: () => state.organizationId,
}));
vi.mock("@/server/features/workspace/credentials", () => ({
  getCredential: async () => state.credential,
}));

import { workspaceProviderKey } from "./workspace-provider-key.byok";

beforeEach(() => {
  state.organizationId = null;
  state.credential = null;
});

describe("open edition provider keys", () => {
  it("never falls back to a deployment key without a workspace", async () => {
    await expect(workspaceProviderKey("dataforseo")).resolves.toEqual({
      key: null,
    });
  });

  it("returns no key when the workspace has not saved one", async () => {
    state.organizationId = "org-a";
    await expect(workspaceProviderKey("openai")).resolves.toEqual({
      key: null,
    });
  });

  it("returns the workspace's own key", async () => {
    state.organizationId = "org-a";
    state.credential = { apiKey: "workspace-key" };
    await expect(workspaceProviderKey("dataforseo")).resolves.toEqual({
      key: "workspace-key",
    });
  });
});
