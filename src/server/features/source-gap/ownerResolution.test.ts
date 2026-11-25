import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadOwnerInputs } from "./ownerCandidates";
import { diagnose } from "./sourceGapDiagnosis";
import { resolveOwner } from "./ownerResolution";
import { ar, fakeWeb, ht, pd, type WebPageEntry } from "./ownerTestWeb";

vi.mock("./ownerCandidates", () => ({ loadOwnerInputs: vi.fn() }));

const site = "https://acme.example";
const BUY = "What is the best dictation software for Mac?";
const MAC = `${site}/dictate/mac`;
const BEST = `${site}/dictate/best`;
const BEST_FINAL = `${site}/dictate/best-dictation-apps`;
const GUIDE = `${site}/guides/dictate-mac`;
const APPS = ["Alpha", "Beta", "Gamma", "Delta"];

const comparison = (title: string): WebPageEntry => ({
  spec: { kind: "roundup", title, items: APPS },
});

function list(urls: string[], complete = true) {
  vi.mocked(loadOwnerInputs).mockResolvedValue({
    inputs: urls.map((url) => ({ url, discoveredVia: ["sitemap"] })),
    notes: [],
    complete,
  });
}

function resolve(
  web: ReturnType<typeof fakeWeb>,
  prompt = BUY,
  override: string | null = null,
  intent: string | null = /^how\b/i.test(prompt) ? null : "recommendation",
) {
  return resolveOwner({
    projectId: "p",
    prompt: { text: prompt, intent },
    ownDomain: "acme.example",
    override,
    sources: [],
    fetchSnapshot: web.fetchSnapshot,
  });
}

beforeEach(() => list([MAC]));

describe("owner resolution", () => {
  it("treats a redirected address and its destination as one page, shown under the destination", async () => {
    list([BEST, BEST_FINAL]);
    const web = fakeWeb({
      [BEST]: { to: BEST_FINAL },
      [BEST_FINAL]: comparison("Best Dictation Apps for Mac (2026)"),
    });
    const { selection } = await resolve(web);
    expect(selection.candidates).toHaveLength(1);
    expect(selection.selected).toMatchObject({
      url: BEST_FINAL,
      alsoListedAs: [BEST],
    });
  });

  it("keeps two different pages that cover similar ground as two candidates", async () => {
    list([MAC, BEST_FINAL]);
    const web = fakeWeb({
      [MAC]: comparison("Best Dictation Apps for Mac"),
      [BEST_FINAL]: comparison("Best Dictation Apps"),
    });
    const { selection } = await resolve(web);
    const urls = selection.candidates.map((c) => c.url);
    expect(urls).toHaveLength(2);
    expect(urls).toContain(MAC);
    expect(urls).toContain(BEST_FINAL);
  });

  it("calls a page that could not be read unassessed, not irrelevant, and does not ask for a new page", async () => {
    list([MAC]);
    const web = fakeWeb({ [MAC]: { blocked: true } });
    const { selection } = await resolve(web);
    expect(selection.selected).toBeNull();
    expect(selection.outcome).toBe("OWNER_UNCERTAIN");
    expect(selection.candidates[0]).toMatchObject({
      url: MAC,
      retrieval: "BLOCKED",
    });
    expect(selection.candidates[0].confidence).toBeUndefined();
  });

  it("makes the pick provisional and lists first an unread page that looks at least as close", async () => {
    const CHECKLIST = `${site}/resources/dictation-checklist`;
    list([BEST_FINAL, CHECKLIST]);
    const web = fakeWeb({
      [BEST_FINAL]: comparison("Best dictation tools"),
      [CHECKLIST]: { blocked: true },
    });
    const { selection } = await resolve(
      web,
      "What should be on a dictation checklist?",
    );
    expect(selection.selected?.url).toBe(BEST_FINAL);
    expect(selection.confidence).toBe("low");
    expect(selection.outcome).toBe("OWNER_UNCERTAIN");
    expect(selection.candidates[0]).toMatchObject({
      url: CHECKLIST,
      retrieval: "BLOCKED",
    });
  });

  it("prefers the page that uses the words few pages use over ones that only share the site's subject", async () => {
    const SHOP = `${site}/shop/running-shoes`;
    const BEST_SHOES = `${site}/guides/best-running-shoes`;
    const SIZING = `${site}/guides/how-to-size-running-shoes`;
    const RETURNS = `${site}/shipping-and-returns`;
    list([SHOP, BEST_SHOES, SIZING, RETURNS]);
    const web = fakeWeb({
      [SHOP]: { spec: pd("Running shoes", "Stride", "Shop running shoes.") },
      [BEST_SHOES]: comparison("The best running shoes for every runner"),
      [SIZING]: { spec: ht("How to size running shoes", ["Measure"]) },
      [RETURNS]: {
        spec: ar(
          "Shipping and returns",
          "You can return running shoes within thirty days for a full refund.",
        ),
      },
    });
    const { selection } = await resolve(
      web,
      "What is the return policy for running shoes?",
      null,
      null,
    );
    expect(selection.candidates[0].url).toBe(RETURNS);
  });

  it("tries a page again once when the failure can pass, and assesses it", async () => {
    const web = fakeWeb({
      [MAC]: { ...comparison("Best Dictation Apps for Mac"), failTimes: 1 },
    });
    const { selection } = await resolve(web);
    expect(web.attempts.get(MAC)).toBe(2);
    expect(selection.selected?.url).toBe(MAC);
    expect(selection.selected?.retrieval).toBe("FETCHED_AND_CLASSIFIED");
  });

  it("is uncertain, never a content gap, when a plausible page keeps failing", async () => {
    const web = fakeWeb({ [MAC]: { ...comparison("x"), failTimes: 9 } });
    const { selection } = await resolve(web);
    expect(selection.candidates[0]).toMatchObject({
      retrieval: "FETCH_FAILED",
      retryable: true,
    });
    expect(selection.outcome).toBe("OWNER_UNCERTAIN");
  });

  it("finds a page that no list names through a link on a page that was read", async () => {
    list([MAC]);
    const web = fakeWeb({
      [MAC]: { ...comparison("Best Dictation Apps for Mac"), links: [GUIDE] },
      [GUIDE]: {
        spec: {
          kind: "howto",
          title: "How to dictate on a Mac",
          steps: ["Turn it on", "Pick a shortcut", "Start speaking"],
        },
      },
    });
    const { selection } = await resolve(web, "How do I dictate on a Mac?");
    expect(selection.selected).toMatchObject({
      url: GUIDE,
      discoveredVia: ["internal_link"],
    });
  });

  it("confirms a content gap only when every plausible page was read and none speaks to the prompt", async () => {
    const web = fakeWeb({
      [MAC]: comparison("Best Dictation Apps for Mac"),
    });
    const { selection } = await resolve(web, "Which CRM is best for plumbers?");
    expect(selection.selected).toBeNull();
    expect(selection.outcome).toBe("CONTENT_GAP_CONFIRMED");
  });

  it("does not confirm a gap when the site's page list may be short", async () => {
    list([MAC], false);
    const web = fakeWeb({ [MAC]: comparison("Best Dictation Apps for Mac") });
    const { selection } = await resolve(web, "Which CRM is best for plumbers?");
    expect(selection.outcome).toBe("OWNER_UNCERTAIN");
  });

  it("does not give a page of unclear purpose high confidence", async () => {
    list([MAC]);
    const web = fakeWeb({
      [MAC]: {
        spec: {
          kind: "article",
          title: "Best dictation software for Mac",
          paragraphs: [
            "Dictation software for Mac turns speech into text.",
            "Many people use dictation software on a Mac every day.",
          ],
        },
      },
    });
    const { selection } = await resolve(web);
    expect(selection.selected?.pageType).toBe("unknown");
    expect(selection.confidence).not.toBe("high");
    expect(selection.selected?.missingEvidence?.join(" ")).toMatch(
      /could not tell what the page is for/i,
    );
  });

  it("reports two genuine pages that match about equally as a close call", async () => {
    list([MAC, BEST_FINAL]);
    const web = fakeWeb({
      [MAC]: comparison("Best Dictation Apps for Mac"),
      [BEST_FINAL]: comparison("Best Mac Dictation Apps"),
    });
    const { selection } = await resolve(web);
    expect(selection.confidence).not.toBe("high");
    expect(selection.outcome).toBe("EXISTING_OWNER_PROBABLE");
    expect(selection.notes.join(" ")).toMatch(/scored almost the same/);
  });

  it("keeps a person's choice, labels it manual, and leaves it unjudged", async () => {
    list([MAC, GUIDE]);
    const web = fakeWeb({
      [MAC]: comparison("Best Dictation Apps for Mac"),
      [GUIDE]: {
        spec: {
          kind: "howto",
          title: "How to dictate on a Mac",
          steps: ["Turn it on", "Pick a shortcut", "Start speaking"],
        },
      },
    });
    const { selection } = await resolve(web, BUY, GUIDE);
    expect(selection).toMatchObject({
      overridden: true,
      confidence: null,
      outcome: "EXISTING_OWNER_CONFIRMED",
    });
    expect(selection.selected?.url).toBe(GUIDE);
  });

  it("leaves a page that no longer exists out of the candidates", async () => {
    list([MAC, `${site}/old`]);
    const web = fakeWeb({
      [MAC]: comparison("Best Dictation Apps for Mac"),
      [`${site}/old`]: { gone: true },
    });
    const { selection } = await resolve(web);
    expect(selection.candidates.map((c) => c.url)).toEqual([MAC]);
    expect(selection.notes.join(" ")).toMatch(/no longer exist/);
  });
});

const stats = {
  engines: [],
  answers: 0,
  ownMentions: 0,
  ownCitations: 0,
  competitorMentions: 0,
  answersWithCompetitorOnly: 0,
};

async function recommendationsFor(
  web: ReturnType<typeof fakeWeb>,
  prompt = BUY,
) {
  const { selection, ownerSnapshot } = await resolve(web, prompt);
  const { recommendations } = diagnose({
    prompt,
    intent: "recommendation",
    now: new Date(),
    owner: ownerSnapshot?.page ?? null,
    sources: [],
    vocabulary: [],
    ownBrandNames: [],
    competitorNames: [],
    runCount: 2,
    selection,
    stats,
  });
  return recommendations.map((r) => r.action);
}

describe("what the analysis recommends about the page", () => {
  it("asks to check the closest pages, and never to create one, while a plausible page was not read", async () => {
    const actions = await recommendationsFor(
      fakeWeb({ [MAC]: { blocked: true } }),
    );
    expect(actions).toContain("choose_owner_page");
    expect(actions).not.toContain("create_owner_page");
  });

  it("asks to create a page only once every plausible page was read and none fits", async () => {
    const actions = await recommendationsFor(
      fakeWeb({ [MAC]: comparison("Best Dictation Apps for Mac") }),
      "Which CRM is best for plumbers?",
    );
    expect(actions).toContain("create_owner_page");
  });

  it("recommends improving the existing page, not a new one, when the only page is the wrong kind", async () => {
    list([GUIDE]);
    const actions = await recommendationsFor(
      fakeWeb({
        [GUIDE]: {
          spec: ht("How to dictate on a Mac", [
            "Turn it on",
            "Pick a shortcut",
            "Start speaking",
          ]),
        },
      }),
    );
    expect(actions).toContain("improve_existing_owner");
    expect(actions).not.toContain("create_owner_page");
  });
});
