import { describe, expect, it } from "vitest";
import { loadExperimentPage } from "./experimentPageLoad";

const deps = (html: string, status = 200) => ({
  validate: async (url: string) => url,
  robots: { allowed: async () => true },
  fetchImpl: async () =>
    new Response(html, { status, headers: { "content-type": "text/html" } }),
});

describe("loadExperimentPage", () => {
  it("returns the visible text of a page and leaves script text out", async () => {
    const page = await loadExperimentPage(
      "https://example.com/pricing",
      deps(
        `<html><head><title>Pricing</title><script>var x="hidden"</script></head><body><h1>Pricing</h1><p>Pay per seat.</p></body></html>`,
      ),
    );
    expect(page).toMatchObject({ ok: true, title: "Pricing" });
    expect(page.ok && page.text).toContain("Pay per seat.");
    expect(page.ok && page.text).not.toContain("hidden");
  });

  it("explains a page that cannot be read instead of returning empty text", async () => {
    const page = await loadExperimentPage(
      "https://example.com/gone",
      deps("", 404),
    );
    expect(page).toEqual({ ok: false, reason: "The page no longer exists." });
  });
});
