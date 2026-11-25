import { afterEach, expect, it, vi } from "vitest";
import { tagManagerPort } from "./TagManagerPort";

afterEach(() => vi.unstubAllGlobals());

it("rejects API redirects without following them with the Google grant", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://example.com/redirect" },
    }),
  );
  vi.stubGlobal("fetch", fetch);

  await expect(
    tagManagerPort("test-grant").container("accounts/1/containers/2"),
  ).rejects.toThrow("Tag Manager returned HTTP 302.");
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "https://tagmanager.googleapis.com/tagmanager/v2/accounts/1/containers/2",
    expect.objectContaining({ redirect: "manual" }),
  );
});
