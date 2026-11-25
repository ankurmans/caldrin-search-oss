import { describe, expect, it, vi } from "vitest";
import type { OwnerSelection } from "@/shared/source-gap-owner";
import { loadOwnerInputs } from "./ownerCandidates";
import { HELD_OUT_SITES } from "./ownerEvalHeldOut";
import { DEV_SITES, type EvalSite } from "./ownerEvalSites";
import { resolveOwner } from "./ownerResolution";
import { fakeWeb } from "./ownerTestWeb";

vi.mock("./ownerCandidates", () => ({ loadOwnerInputs: vi.fn() }));

const PLAUSIBLE = 0.12;

/** True when the analysis would tell the person to create a page. */
function createsPage(s: OwnerSelection): boolean {
  if (s.outcome) return s.outcome === "CONTENT_GAP_CONFIRMED";
  return (
    !s.selected &&
    s.listComplete !== false &&
    !s.candidates.some((c) => c.score >= PLAUSIBLE)
  );
}

async function run(site: EvalSite) {
  const rows = [];
  for (const c of site.cases) {
    vi.mocked(loadOwnerInputs).mockResolvedValue({
      inputs: site.listed.map((url) => ({ url, discoveredVia: ["sitemap"] })),
      notes: [],
      complete: true,
    });
    const web = fakeWeb(site.web);
    const { selection } = await resolveOwner({
      projectId: "p",
      prompt: {
        text: c.prompt,
        intent: c.choose ? "recommendation" : null,
      },
      ownDomain: site.domain,
      override: null,
      sources: [],
      fetchSnapshot: web.fetchSnapshot,
    });
    rows.push({
      site: site.name,
      prompt: c.prompt,
      owner: c.owner,
      picked: selection.selected?.url ?? null,
      confidence: selection.confidence,
      outcome: selection.outcome ?? null,
      top3: selection.candidates.slice(0, 3).map((x) => x.url),
      creates: createsPage(selection),
      ownerRead: c.owner ? web.served.has(c.owner) : null,
    });
  }
  return rows;
}

const share = (n: number, d: number) => (d === 0 ? null : n / d);

function metrics(rows: Awaited<ReturnType<typeof run>>) {
  const owned = rows.filter((r) => r.owner);
  return {
    cases: rows.length,
    top1: share(owned.filter((r) => r.picked === r.owner).length, owned.length),
    top3Recall: share(
      owned.filter((r) => r.owner && r.top3.includes(r.owner)).length,
      owned.length,
    ),
    falseMissingPage: share(
      owned.filter((r) => r.creates).length,
      owned.length,
    ),
    gapsFound: share(
      rows.filter((r) => !r.owner && r.creates).length,
      rows.filter((r) => !r.owner).length,
    ),
    unsupportedHighConfidence: share(
      rows.filter((r) => r.confidence === "high" && r.picked !== r.owner)
        .length,
      rows.length,
    ),
    retrievalCoverage: share(
      owned.filter((r) => r.ownerRead).length,
      owned.length,
    ),
    abstained: share(
      rows.filter((r) => !r.picked || r.confidence === "low").length,
      rows.length,
    ),
  };
}

describe("owner selection quality on labelled sites", () => {
  it.each([
    ["dev", DEV_SITES],
    ["held-out", HELD_OUT_SITES],
  ])("%s sites", async (split, sites) => {
    const rows = (await Promise.all(sites.map(run))).flat();
    if (process.env.OWNER_EVAL_REPORT)
      process.stderr.write(
        `EVAL ${split} ${JSON.stringify(metrics(rows))}\n${rows
          .filter((r) => r.picked !== r.owner)
          .map((r) => `  MISS ${JSON.stringify(r)}`)
          .join("\n")}\n`,
      );
    const m = metrics(rows);
    // Floors just under what the scorer reached, so a regression shows. The
    // held-out sites were not used to tune it.
    expect(m.top1).toBeGreaterThanOrEqual(0.8);
    expect(m.falseMissingPage).toBe(0);
    expect(m.unsupportedHighConfidence).toBe(0);
  });
});
