import { describe, expect, it, vi } from "vitest";
import { getWorkspaceMode } from "./credentials";

vi.mock("cloudflare:workers", () => ({
  env: { AUTH_MODE: "cloudflare_access" },
}));
vi.mock("@/lib/byok-preview", () => ({ isByokPreview: true }));
vi.mock("@/db", () => ({
  db: {
    select: () => {
      throw new Error("The open edition must not read a stored mode");
    },
  },
}));

describe("the open edition", () => {
  it("runs every workspace on its own keys, whatever auth mode or stored row", async () => {
    await expect(getWorkspaceMode("any-org")).resolves.toBe("byok");
  });
});
