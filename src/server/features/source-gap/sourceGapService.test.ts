import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { seedMeasurementRun } from "@/server/features/ai-visibility/services/aiMeasurementTestSeed";
import { ensurePromptSetVersion } from "@/server/features/ai-visibility/services/aiPromptSetVersions";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { loadOwnerInputs } from "./ownerCandidates";
import {
  analyzePrompt,
  createSourceGapOpportunity,
  getTopicOverview,
  listAnalysisSummaries,
  setOwnerPage,
} from "./sourceGapService";

const { testDb, web } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  const pages: Record<string, { status?: number; html?: string }> = {};
  return {
    testDb: await createAiVisibilityTestDb(),
    web: { pages, requested: [] as string[] },
  };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/audit/url-policy", async (original) => ({
  ...(await original<object>()),
  normalizeAndValidateStartUrl: async (url: string) => url,
}));
vi.mock("@/server/lib/public-fetch", () => ({
  publicFetch: async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname === "/robots.txt")
      return new Response("", { status: 404 });
    web.requested.push(url.origin + url.pathname);
    const page = web.pages[url.origin + url.pathname];
    if (!page) return new Response("", { status: 404 });
    return new Response(page.html ?? "", {
      status: page.status ?? 200,
      headers: { "content-type": "text/html" },
    });
  },
}));
vi.mock("./ownerCandidates", () => ({ loadOwnerInputs: vi.fn() }));

const PROMPT =
  "Which transcription tool is pay as you go with no subscription?";
const scope = { projectId: "project", organizationId: "organization" };
const OWNER = "https://caldrin.co/pay-as-you-go-transcription";
const BLOG = "https://blog.example/best-pay-as-you-go-transcription";
const BLOG_TWO = "https://reviews.example/transcription-tools";
const RIVAL = "https://rival.example/pricing";
const GONE = "https://gone.example/old-review";
const DICTATION = "What is the best dictation software for Mac?";
const DICTATION_REVIEW = "https://blog.example/best-dictation-software-mac";

const page = (title: string, body: string) =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

const REVIEW = (name: string) =>
  page(
    "Best pay-as-you-go transcription tools",
    `<p>We tested five tools for ${name}. Pay as you go pricing starts at $0.25 per minute with no subscription. Rival is the cheapest.</p>
     <h2>Comparison</h2>
     <table><tr><th>Tool</th><th>Price</th><th>Offline</th></tr>
     <tr><td>Rival</td><td>$0.25 per minute</td><td>No</td></tr>
     <tr><td>Other</td><td>$9/month</td><td>Yes</td></tr></table>
     <h2>Our verdict</h2><p>Best for casual use: Rival.</p>`,
  );

const daysAgo = (d: number) =>
  new Date(Date.now() - d * 86_400_000).toISOString();

async function seed() {
  const rows = configuration({
    engines: ["chatgpt"],
    prompts: [
      { text: PROMPT },
      { text: "Which dictation apps work offline?" },
      { text: DICTATION },
    ],
  });
  await repo.saveConfiguration(rows);
  const promptIds = rows.prompts.map((p) => p.id);
  const versionId = await ensurePromptSetVersion(rows.tracker.id, promptIds);
  for (const createdAt of [daysAgo(3), daysAgo(2)])
    await seedMeasurementRun(
      testDb.db,
      { trackerId: rows.tracker.id, promptIds, versionId },
      [
        {
          prompt: 0,
          rivalMentioned: true,
          text: "Rival is the pay as you go pick.",
          sources: [
            RIVAL,
            `${BLOG}?utm_source=chatgpt.com`,
            BLOG_TWO,
            GONE,
            "https://files.example/report.pdf",
          ],
        },
        {
          prompt: 2,
          rivalMentioned: true,
          text: "Rival is the dictation pick.",
          sources: [DICTATION_REVIEW],
        },
      ],
      { createdAt },
    );
  dictationPromptId = promptIds[2];
  return promptIds[0];
}

let promptId: string;
let dictationPromptId: string;

const analyze = (forceRefresh = false) =>
  analyzePrompt(scope, { projectId: scope.projectId, promptId, forceRefresh });

beforeEach(async () => {
  await testDb.seedProject();
  promptId = await seed();
  web.requested.length = 0;
  for (const key of Object.keys(web.pages)) delete web.pages[key];
  Object.assign(web.pages, {
    [RIVAL]: {
      html: page(
        "Rival pricing",
        "<p>Pay as you go at $0.25 per minute. No subscription.</p>",
      ),
    },
    [BLOG]: { html: REVIEW("blog") },
    [BLOG_TWO]: { html: REVIEW("reviews") },
    [DICTATION_REVIEW]: { html: REVIEW("dictation") },
    [OWNER]: {
      html: page(
        "Pay as you go transcription for your team",
        "<p>Our transcription software turns speech into text for busy people.</p>",
      ),
    },
  });
  vi.mocked(loadOwnerInputs).mockResolvedValue({
    inputs: [{ url: OWNER, title: "Pay as you go transcription" }],
    notes: [],
    complete: true,
  });
});

describe("source gap analysis", () => {
  it("compares cited pages with the owner page and binds every claim to evidence", async () => {
    const analysis = await analyze();

    expect(analysis.owner.selected?.url).toBe(OWNER);
    // The tracking-parameter spelling is the same source as the plain one.
    const blog = analysis.sources.filter((s) => s.url.includes("blog.example"));
    expect(blog).toHaveLength(1);
    expect(blog[0].answers).toBe(2);
    // A dead page and a file are listed with a reason, not dropped.
    const status = (needle: string) =>
      analysis.sources.find((s) => s.url.includes(needle))?.snapshot?.status;
    expect(status("gone.example")).toBe("not_found");
    expect(status("report.pdf")).toBe("not_html");

    expect(analysis.rootCauses.map((c) => c.category)).toContain(
      "missing_facts",
    );
    const cited = new Set(analysis.sources.map((s) => s.url));
    const categories = new Set(analysis.rootCauses.map((c) => c.category));
    for (const rec of analysis.recommendations) {
      expect(rec.supportingUrls.every((u) => cited.has(u))).toBe(true);
      expect(categories.has(rec.rootCause)).toBe(true);
    }
    for (const cause of analysis.rootCauses)
      expect(["observed", "inferred", "hypothesis"]).toContain(cause.level);
  });

  it("never claims to know what an engine will do", async () => {
    const analysis = await analyze();
    const claims = [
      ...analysis.rootCauses.map((c) => c.evidence),
      ...analysis.recommendations.flatMap((r) => [
        r.reason,
        r.expectedEffect,
        r.priorityReason,
      ]),
    ];
    const causal =
      /\b(will (get|be|help|improve|increase|boost|rank|make|ensure|fix)|guarantee[sd]?|ensures?|proves?|is why|are why|caused by|because of this|this is the reason)\b/i;
    expect(claims.filter((c) => causal.test(c))).toEqual([]);
  });

  it("reuses stored page copies, then records what changed on a refresh", async () => {
    const first = await analyze();
    const fetchedOnce = web.requested.length;
    const second = await analyze();
    expect(web.requested.length).toBe(fetchedOnce);

    web.pages[OWNER] = {
      html: page(
        "Pay as you go transcription",
        "<p>Pay as you go at $0.20 per minute. No subscription.</p>",
      ),
    };
    const refreshed = await analyze(true);
    expect(refreshed.previousAnalysisId).toBe(second.id);
    expect(refreshed.ownerSnapshot?.id).not.toBe(first.ownerSnapshot?.id);
    expect(refreshed.changes.length).toBeGreaterThan(0);
  });

  it("says there is no owner page when nothing on the site fits the prompt", async () => {
    vi.mocked(loadOwnerInputs).mockResolvedValue({
      inputs: [{ url: "https://caldrin.co/about", title: "About our team" }],
      notes: [],
      complete: true,
    });
    const analysis = await analyze();
    expect(analysis.owner.selected).toBeNull();
    expect(analysis.rootCauses.map((c) => c.category)).toContain(
      "no_owner_page",
    );
    expect(analysis.recommendations.map((r) => r.action)).toContain(
      "create_owner_page",
    );
  });

  it("stores one Search Opportunity per analysis with the answers behind it", async () => {
    const analysis = await analyze();
    const first = await createSourceGapOpportunity(scope, {
      analysisId: analysis.id,
    });
    const again = await createSourceGapOpportunity(scope, {
      analysisId: analysis.id,
    });
    expect(again.opportunityId).toBe(first.opportunityId);

    const detail = await OpportunityRepository.getOpportunityDetail(
      "project",
      first.opportunityId,
    );
    const evidence = JSON.stringify(detail?.evidence ?? []);
    for (const runId of analysis.runIds) expect(evidence).toContain(runId);
    const [summary] = await listAnalysisSummaries("project");
    expect(summary.opportunityId).toBe(first.opportunityId);
  });

  it("groups what repeats across a topic's analyzed prompts", async () => {
    await analyze();
    const topics = await getTopicOverview("project");
    const topic = topics.find((t) => t.analyzed > 0);
    expect(topic).toMatchObject({ analyzed: 1 });
    expect(topic?.prompts).toBeGreaterThanOrEqual(1);
  });
});

// Pages as the real site serves them: icon titles inside <svg>, and a short
// address whose canonical tag names the long one.
const site = (
  title: string,
  h1: string,
  canonical?: string,
  tools: string[] = [],
) =>
  `<html><head><title>${title}</title>${canonical ? `<link rel="canonical" href="${canonical}">` : ""}</head><body><svg><title>YouTube</title></svg><svg><title>TikTok</title></svg><h1>${h1}</h1><p>${"We compare tools on price and accuracy. ".repeat(20)}</p>${tools.map((t) => `<h2>${t}: where it fits</h2>`).join("")}${tools.length ? "<h2>Which one should you choose?</h2>" : ""}</body></html>`;
const TOOLS = ["Alpha", "Beta", "Gamma", "Delta"];

describe("finding the page that already owns a prompt (Pepys regressions)", () => {
  const PAYG = "https://caldrin.co/best/pay-as-you-go-transcription";
  const PRICING = "https://caldrin.co/pricing";
  const GUIDE = "https://caldrin.co/dictate/guides/how-to-dictate-on-mac";
  const BEST_SHORT = "https://caldrin.co/dictate/best";
  const BEST = "https://caldrin.co/dictate/best-dictation-apps";

  beforeEach(() => {
    Object.assign(web.pages, {
      [PAYG]: {
        html: site(
          "Best Pay-As-You-Go Transcription Tools (2026) | Pepys",
          "The best pay-as-you-go transcription tools",
          PAYG,
          TOOLS,
        ),
      },
      [PRICING]: {
        html: site(
          "Pricing: Pay-As-You-Go Transcription Credits | Pepys",
          "Free to start. One purchase unlocks everything.",
          PRICING,
        ),
      },
      [GUIDE]: {
        html: site(
          "How to Dictate on a Mac: Voice Typing Steps | Pepys Dictate",
          "How to Dictate on a Mac",
          GUIDE,
        ),
      },
      [BEST_SHORT]: {
        html: site(
          "Best Dictation Apps and Software (2026) | Pepys Dictate",
          "Best Dictation Apps and Software",
          BEST,
          TOOLS,
        ),
      },
      [BEST]: {
        html: site(
          "Best Dictation Apps and Software (2026) | Pepys Dictate",
          "Best Dictation Apps and Software",
          BEST,
          TOOLS,
        ),
      },
    });
  });

  it("names the existing pay-as-you-go comparison page as the owner and never suggests a new page", async () => {
    // Sitemap addresses only: no titles, no Search Console data.
    vi.mocked(loadOwnerInputs).mockResolvedValue({
      inputs: [
        { url: "https://caldrin.co/tools/free-transcription" },
        { url: PRICING },
        { url: PAYG },
        { url: "https://caldrin.co/about", title: "About Pepys" },
      ],
      notes: [],
      complete: true,
    });
    web.pages["https://caldrin.co/tools/free-transcription"] = {
      html: site("Free Transcription | Pepys", "Free Transcription"),
    };

    const analysis = await analyze();

    expect(analysis.owner.selected?.url).toBe(PAYG);
    expect(analysis.owner.selected?.title).toBe(
      "Best Pay-As-You-Go Transcription Tools (2026) | Pepys",
    );
    expect(analysis.owner.candidates.map((c) => c.url)).toContain(PRICING);
    expect(analysis.rootCauses.map((c) => c.category)).not.toContain(
      "no_owner_page",
    );
    expect(analysis.recommendations.map((r) => r.action)).not.toContain(
      "create_owner_page",
    );
  });

  it("picks the commercial comparison page over a how-to guide, even when only the guide earns the search queries", async () => {
    vi.mocked(loadOwnerInputs).mockResolvedValue({
      inputs: [
        {
          url: GUIDE,
          title: "How to Dictate on a Mac: Voice Typing Steps | Pepys Dictate",
          gscQueries: Array.from(
            { length: 10 },
            (_, i) => `dictation mac ${i}`,
          ),
        },
        { url: BEST_SHORT },
        { url: BEST },
      ],
      notes: [],
      complete: true,
    });

    const analysis = await analyzePrompt(scope, {
      projectId: scope.projectId,
      promptId: dictationPromptId,
      forceRefresh: false,
    });

    expect(analysis.owner.selected?.url).toBe(BEST);
    expect(analysis.owner.selected?.pageType).toBe("comparison");
    const guide = analysis.owner.candidates.find((c) => c.url === GUIDE);
    expect(guide?.pageType).toBe("how_to");
    expect(guide?.score ?? 0).toBeLessThan(analysis.owner.selected?.score ?? 0);
    // /dictate/best and /dictate/best-dictation-apps are one page.
    expect(
      analysis.owner.candidates.filter((c) => c.url.includes("/dictate/best")),
    ).toHaveLength(1);
  });

  it("asks to check the closest existing pages, not to create one, when the site's page list may be short", async () => {
    vi.mocked(loadOwnerInputs).mockResolvedValue({
      inputs: [{ url: "https://caldrin.co/about", title: "About our team" }],
      notes: ["The sitemap could not be read."],
      complete: false,
    });

    const analysis = await analyze();

    expect(analysis.owner.selected).toBeNull();
    expect(analysis.rootCauses.map((c) => c.category)).toContain(
      "owner_unconfirmed",
    );
    const actions = analysis.recommendations.map((r) => r.action);
    expect(actions).toContain("choose_owner_page");
    expect(actions).not.toContain("create_owner_page");
  });

  it("uses the page a person chose, and only accepts a page on the project's own site", async () => {
    vi.mocked(loadOwnerInputs).mockResolvedValue({
      inputs: [{ url: PAYG }],
      notes: [],
      complete: true,
    });
    await setOwnerPage({
      projectId: scope.projectId,
      promptId,
      ownerUrl: PRICING,
    });

    const analysis = await analyze();

    expect(analysis.owner).toMatchObject({ overridden: true });
    expect(analysis.owner.selected?.url).toBe(PRICING);
    await expect(
      setOwnerPage({
        projectId: scope.projectId,
        promptId,
        ownerUrl: "https://elsewhere.example/page",
      }),
    ).rejects.toThrow("has to be on caldrin.co");
  });
});
