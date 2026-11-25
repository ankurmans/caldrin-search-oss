import { vi } from "vitest";

// Unit tests of provider transports supply the key through a mocked runtime
// environment. The open edition's resolver, which only reads workspace keys,
// is covered by its own tests (workspace-provider-key.byok.test.ts).
vi.mock("@/server/lib/workspace-provider-key", () => ({
  workspaceProviderKey: async () => null,
}));
