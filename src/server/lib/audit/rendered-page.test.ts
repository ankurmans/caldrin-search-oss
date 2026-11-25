import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderedPageService } from "./rendered-page";
import { MAX_HTML_BYTES } from "./html-response";
import { isAuditRenderingAllowed } from "./rendering-policy";

const url = "https://example.com/page";
const html =
  "<html><head><title>Rendered</title></head><body>Loaded content</body></html>";
const browser = { quickAction: vi.fn() };
function cloudflare(
  status = 200,
  content = html,
  finalUrl = url,
  headers: Record<string, string> = {},
) {
  return Response.json({
    success: true,
    result: content,
    meta: { status, finalUrl, headers },
  });
}
function context(overrides: Record<string, unknown> = {}, status = 200) {
  return Response.json(
    {
      results: [
        { url, final_url: url, text: html, format: "html", ...overrides },
      ],
    },
    { status },
  );
}
// Stands in for provider-access.ts, which puts the key (or the gateway) on.
const tinyfishFetch: typeof fetch = (input, init) => fetch(input, init);
function render(
  options: { browser?: typeof browser; tinyfishFetch?: typeof fetch } = {
    browser,
    tinyfishFetch,
  },
  target = url,
) {
  const usage = { cloudflareAttempts: 0, tinyfishCredits: 0 };
  const page = RenderedPageService.renderPage(target, {
    ...options,
    auditId: "audit",
    usage,
  });
  return { page, usage };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("rendered page providers", () => {
  it("renders on Cloudflare with its full timeout and never calls TinyFish", async () => {
    browser.quickAction.mockResolvedValue(
      cloudflare(200, html, url, { "set-cookie": "one\ntwo" }),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { page, usage } = render();
    expect(await page).toEqual({ html, status: 200 });
    expect(usage).toEqual({ cloudflareAttempts: 1, tinyfishCredits: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(browser.quickAction).toHaveBeenCalledWith("content", {
      url,
      cacheTTL: 0,
      gotoOptions: { waitUntil: "networkidle2", timeout: 20_000 },
    });
  });

  it.each([
    ["a bot challenge", cloudflare(200, "<title>Just a moment...</title>")],
    [
      "a mitigation header",
      cloudflare(200, html, url, { "Cf-MiTiGaTeD": "challenge" }),
    ],
    ["an origin block", cloudflare(403)],
    ["an origin error", cloudflare(503)],
    ["a browser error", new Response(null, { status: 429 })],
  ])(
    "falls back to fresh full HTML from TinyFish after %s, counting both attempts",
    async (_case, cloudflareResponse) => {
      browser.quickAction.mockResolvedValue(cloudflareResponse);
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(context());
      const { page, usage } = render();
      expect(await page).toEqual({ html, status: null });
      expect(usage).toEqual({ cloudflareAttempts: 1, tinyfishCredits: 0 });
      const [endpoint, request] = fetchMock.mock.calls[0];
      expect(endpoint).toBe("https://api.fetch.tinyfish.ai");
      expect(
        JSON.parse(typeof request?.body === "string" ? request.body : ""),
      ).toMatchObject({
        urls: [url],
        format: "html",
        ttl: 0,
      });
      // The key is the transport's: rendering never handles it.
      expect(new Headers(request?.headers).has("x-api-key")).toBe(false);
    },
  );

  it("does not mistake a background challenge script for a blocked page", async () => {
    browser.quickAction.mockResolvedValue(
      cloudflare(
        200,
        '<html><head><title>Our products</title><script src="/challenge-platform/check"></script></head><body>Real content</body></html>',
      ),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await render().page;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the first 1 MiB of an oversized render, as the direct crawl does", async () => {
    const head = "<html><head><title>Big page</title></head><body>";
    browser.quickAction.mockResolvedValue(
      cloudflare(200, head + "x".repeat(MAX_HTML_BYTES)),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { html: rendered } = await render().page;
    expect(rendered.startsWith(head)).toBe(true);
    expect(new TextEncoder().encode(rendered).length).toBe(MAX_HTML_BYTES);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    cloudflare(200, html, "https://elsewhere.example/"),
    cloudflare(200, "  "),
    Response.json({ success: true, result: html }),
  ])(
    "fails without a fallback when Cloudflare returns an unusable document",
    async (response) => {
      browser.quickAction.mockResolvedValue(response);
      const { page, usage } = render({ browser });
      await expect(page).rejects.toThrow("Unable to render");
      expect(usage).toEqual({ cloudflareAttempts: 1, tinyfishCredits: 0 });
    },
  );

  it("renders through TinyFish alone where there is no browser", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(context());
    const { page, usage } = render({ tinyfishFetch });
    expect(await page).toEqual({ html, status: null });
    expect(usage).toEqual({ cloudflareAttempts: 0, tinyfishCredits: 0 });
  });

  it.each([
    { text: null },
    { text: "   " },
    { final_url: "https://elsewhere.example/" },
  ])("rejects an unusable TinyFish document %o", async (overrides) => {
    browser.quickAction.mockRejectedValue(new Error("Browser failed"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(context(overrides));
    const { page } = render();
    await expect(page).rejects.toThrow("Unable to render");
  });

  it("rejects a TinyFish HTTP error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "timeout" }, { status: 408 }),
    );
    const { page } = render({ tinyfishFetch });
    await expect(page).rejects.toThrow("Unable to render");
  });

  it("fails once per provider without retrying, logging no provider payload", async () => {
    browser.quickAction.mockRejectedValue(
      new Error("private provider payload"),
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("private provider payload", { status: 429 }),
      );
    const { page, usage } = render();
    await expect(page).rejects.toThrow("Unable to render");
    expect(usage).toEqual({ cloudflareAttempts: 1, tinyfishCredits: 0 });
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
      "private provider payload",
    );
  });

  it.each([
    "http://127.0.0.1/",
    "http://metadata.google.internal/",
    "https://name:password@example.com/",
    "file:///etc/passwd",
  ])("rejects unsafe target %s before calling a provider", async (target) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(render(undefined, target).page).rejects.toThrow(
      "Invalid rendering target",
    );
    expect(browser.quickAction).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("rendering availability", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("exists when a browser is bound or a TinyFish key is set, whatever the auth mode", async () => {
    // A legacy Wrangler install runs cloudflare_access with no browser.
    vi.stubEnv("AUTH_MODE", "cloudflare_access");
    expect(await isAuditRenderingAllowed()).toBe(false);
    vi.stubEnv("TINYFISH_API_KEY", "tinyfish-test-key");
    expect(await isAuditRenderingAllowed()).toBe(true);
    // An Alchemy preview runs local_noauth with a browser.
    vi.stubEnv("TINYFISH_API_KEY", "");
    vi.stubEnv("AUTH_MODE", "local_noauth");
    vi.stubEnv("AUDIT_BROWSER_RENDERING", "true");
    expect(await isAuditRenderingAllowed()).toBe(true);
  });
});
