import { expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: { AUTH_MODE: "password", DATAFORSEO_API_KEY: "deployment-credential" },
}));

vi.mock("@/server/features/workspace/credentials", () => ({
  getCredential: (organizationId: string) =>
    organizationId === "configured" ? { apiKey: "workspace-credential" } : null,
}));

vi.mock(
  "@/server/lib/workspace-provider-key",
  () => import("./workspace-provider-key.byok"),
);

import { withAiWallet } from "./ai-wallet-scope";
import { getDataforseoFetch, hasProviderAccess } from "./provider-access";
import { runInWorkspace } from "./workspace-scope";

it("uses the configured workspace key", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  vi.stubGlobal("fetch", fetchMock);
  try {
    await runInWorkspace("configured", async () => {
      const authorizedFetch = await getDataforseoFetch();
      await authorizedFetch("https://example.com");
    });
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Basic workspace-credential");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("requires a workspace key even if a deployment key is present", async () => {
  await expect(getDataforseoFetch()).rejects.toMatchObject({
    code: "DATAFORSEO_AUTH_FAILED",
  });
  await runInWorkspace("unconfigured", async () => {
    await expect(hasProviderAccess("dataforseo")).resolves.toBe(false);
    await expect(getDataforseoFetch()).rejects.toMatchObject({
      code: "DATAFORSEO_AUTH_FAILED",
    });
  });
});

it("ignores hosted funding when resolving a workspace key", async () => {
  const reservation = {
    organizationId: "unconfigured",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await runInWorkspace(reservation.organizationId, () =>
    withAiWallet(reservation, async () => {
      await expect(hasProviderAccess("dataforseo")).resolves.toBe(false);
    }),
  );
});
