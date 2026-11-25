import { describe, expect, it } from "vitest";
import { extractPage } from "./pageExtractor";
import { rankOwnerCandidates, selectOwner } from "./ownerPageSelector";

const site = "https://acme.example";
const PROMPT = "What is the best dictation software for Mac?";

const APPS = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];

function roundup(title: string, h1: string, apps: string[], extra = "") {
  return `<html><head><title>${title}</title></head><body><h1>${h1}</h1>
<p>We compared the apps on accuracy, price and privacy. ${extra}</p>
<table><tr><th>App</th><th>Price</th><th>Works offline</th></tr>
${apps.map((a) => `<tr><td>${a}</td><td>$9 a month</td><td>Yes</td></tr>`).join("")}</table>
${apps.map((a) => `<h2>${a}: where it fits and where it does not</h2><p>${a} suits some people.</p>`).join("")}
<h2>Which dictation app should you choose?</h2><p>Our pick depends on the job.</p>
</body></html>`;
}

const generic = extractPage(
  roundup(
    "Best Dictation Apps and Software (2026)",
    "Best Dictation Apps and Software",
    APPS,
    "Some run on Mac, others on Windows.",
  ),
  `${site}/dictate/best-dictation-apps`,
);
const macComparison = extractPage(
  roundup(
    "Best Dictation Apps for Mac (2026)",
    "Best Dictation Apps for Mac",
    APPS.slice(0, 5),
    "Every app here runs on a Mac.",
  ),
  `${site}/dictate/mac`,
);
// Titled "best", but it sells one product and compares nothing.
const macLanding = extractPage(
  `<html><head><title>Best Dictation App for Mac</title>
<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Acme Dictate"}</script></head><body>
<h1>Best Dictation App for Mac</h1><p>Acme Dictate turns speech into text on your Mac.</p>
<h2>Features</h2><p>Fast and private.</p><h2>Pricing</h2><p>$29 once.</p><h2>Download</h2></body></html>`,
  `${site}/dictate/mac-app`,
);
// FAQ-style headings and a product schema, as a vendor's own guide has them.
const faqGuide = extractPage(
  `<html><head><title>How to Dictate on a Mac | Acme</title>
<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Acme Dictate"}</script></head><body>
<h1>How to Dictate on a Mac</h1><h2>Does Mac dictation work offline?</h2><h2>Can I dictate into any app?</h2></body></html>`,
  `${site}/dictate/guides/dictate-mac`,
);
const howTo = extractPage(
  `<html><head><title>How to Dictate on a Mac</title></head><body><h1>How to Dictate on a Mac</h1>
<h2>Step 1: Turn dictation on</h2><h2>Step 2: Pick a shortcut</h2><h2>Step 3: Start speaking</h2></body></html>`,
  `${site}/dictate/guides/how-to-dictate-on-mac`,
);

const pricing = extractPage(
  `<html><head><title>Pricing | Acme Dictate</title></head><body><h1>Pricing</h1>
<table><tr><th>Plan</th><th>Price</th></tr><tr><td>Personal</td><td>$29 once</td></tr><tr><td>Team</td><td>$79 once</td></tr></table>
<p>No subscription. Pay once and keep it.</p></body></html>`,
  `${site}/pricing`,
);

const inputs = (...pages: (typeof generic)[]) =>
  pages.map((page) => ({ url: page.finalUrl, page }));

describe("intent-aware owner scoring", () => {
  it("picks the Mac comparison over the generic roundup when both really compare products", () => {
    const ranked = rankOwnerCandidates(
      PROMPT,
      inputs(generic, macComparison),
      "recommendation",
    );
    expect(ranked.map((c) => c.pageType)).toEqual(["comparison", "comparison"]);
    expect(ranked[0].url).toBe(macComparison.finalUrl);
    expect(ranked[0].optionsCompared).toBe(5);
    expect(selectOwner(PROMPT, ranked, null).selected?.url).toBe(
      macComparison.finalUrl,
    );
  });

  it("does not let a one-product Mac page win because its title says best and it says Mac", () => {
    const ranked = rankOwnerCandidates(
      PROMPT,
      inputs(macLanding, generic),
      "recommendation",
    );
    const landing = ranked.find((c) => c.url === macLanding.finalUrl);
    expect(ranked[0].url).toBe(generic.finalUrl);
    expect(landing?.pageType).toBe("product");
    expect(landing?.reasons.join(" ")).toMatch(/does not compare products/);
  });

  it("keeps a how-to guide out of a buying question, and in for a how-to one", () => {
    const buy = rankOwnerCandidates(
      PROMPT,
      inputs(howTo, macComparison),
      "recommendation",
    );
    expect(buy[0].url).toBe(macComparison.finalUrl);
    expect(buy.find((c) => c.url === howTo.finalUrl)?.typeFit).toBe(0);
    const learn = rankOwnerCandidates(
      "How do I dictate on a Mac?",
      inputs(howTo, macComparison),
    );
    expect(learn[0].url).toBe(howTo.finalUrl);
  });

  it("reads a vendor's FAQ-style guide as a guide, not as a product page", () => {
    const [guide] = rankOwnerCandidates(
      "How do I dictate on a Mac?",
      inputs(faqGuide, macComparison),
    );
    expect(guide).toMatchObject({ url: faqGuide.finalUrl, pageType: "how_to" });
  });

  it("gives the generic roundup the prompt that never mentions Mac", () => {
    const ranked = rankOwnerCandidates(
      "What is the best dictation software?",
      inputs(macComparison, generic),
      "recommendation",
    );
    expect(ranked[0].url).toBe(generic.finalUrl);
  });

  it("says how sure it is of each of the closest pages, with reasons", () => {
    const [first, ...rest] = rankOwnerCandidates(
      PROMPT,
      inputs(generic, macComparison, macLanding),
      "recommendation",
    );
    for (const c of [first, ...rest]) {
      expect(c.confidence).toBeDefined();
      expect(c.reasons.length).toBeGreaterThan(0);
    }
  });

  it("lets a single product's pricing page answer a question about what it costs", () => {
    const ranked = rankOwnerCandidates(
      "How much does Acme Dictate cost, and is there a subscription?",
      inputs(generic, pricing),
      "pricing",
    );
    expect(ranked[0]).toMatchObject({
      url: pricing.finalUrl,
      pageType: "pricing",
    });
  });
});
