import { expect, it, vi } from "vitest";
import { inspectPublicEvidence, publicEvidenceUrl } from "./claimEvidence";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/public-fetch", () => ({ publicFetch: mocks.fetch }));
vi.mock("@/server/lib/audit/url-policy", () => ({
  normalizeAndValidateStartUrl: async (url: string) => url,
}));

it("uses robots, does not consume scripts, and stores source metadata and exact visible passages", async () => {
  mocks.fetch.mockResolvedValueOnce(
    new Response("User-agent: *\nAllow: /", {
      headers: { "content-type": "text/plain" },
    }),
  );
  mocks.fetch.mockResolvedValueOnce(
    new Response(
      '<html><head><title>Pricing</title><link rel="canonical" href="/plans"></head><body><script>Unexpected instructions</script><p>Standard costs USD 20 per month.</p></body></html>',
      { headers: { "content-type": "text/html" } },
    ),
  );
  const result = await inspectPublicEvidence(
    "https://example.com/pricing",
    "Standard costs USD 20 per month.",
  );
  expect(result).toMatchObject({
    title: "Pricing",
    canonicalUrl: "https://example.com/plans",
    httpStatus: 200,
    excerpt: "Standard costs USD 20 per month.",
    contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
  });
});

it("honors an explicit robots prohibition and declines unsupported schemes", async () => {
  mocks.fetch.mockClear();
  mocks.fetch.mockResolvedValueOnce(
    new Response("User-agent: *\nDisallow: /", {
      headers: { "content-type": "text/plain" },
    }),
  );
  await expect(
    inspectPublicEvidence("https://example.com/private", "some public phrase"),
  ).resolves.toMatchObject({ reason: "robots_unavailable_or_disallowed" });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(() => publicEvidenceUrl("file:///document")).toThrow();
});
