/* eslint-disable max-lines */
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInWorkspace } from "@/server/lib/workspace-scope";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { LinkEvidenceService } from "./LinkEvidenceService";
import { LinkGapService } from "./LinkGapService";
import { LinkOutreachService } from "./LinkOutreachService";
import { LinkProspectService } from "./LinkProspectService";
import { LinkReportService } from "./LinkReportService";
import { LinkVerificationService } from "./LinkVerificationService";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});
vi.mock("@/db/runBatch", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return {
    runBatch: async (
      build: (tx: ReturnType<typeof createProxyDb>) => Promise<unknown>[],
    ) => {
      for (const statement of build(createProxyDb(() => state.database)))
        await statement;
    },
  };
});
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => "operator-key",
  getRequiredEnvValue: async () => "operator-key",
  getWorkersEnv: async () => ({}),
}));
vi.mock("@/server/features/content/services/ContentService", () => ({
  ContentService: {},
}));

const providerFetch = vi.fn<typeof fetch>();

const person = (projectId = "p1") => ({
  projectId,
  organizationId: "org-cloud",
  userId: "u1",
  userEmail: "u@e.com",
});
const agent = (projectId = "p1") => ({
  ...person(projectId),
  actor: "mcp" as const,
});
const inWorkspace = <T>(fn: () => Promise<T>) =>
  runInWorkspace("org-cloud", fn);
const rows = (statement: string) =>
  state.database?.prepare(statement).all() ?? [];

const entry = (target: string) => ({
  target,
  rank: 400,
  backlinks: 3,
  referring_pages: 2,
  backlinks_spam_score: 5,
  first_seen: "2025-01-02 00:00:00 +00:00",
});
const task = (path: string[], items: unknown[]) =>
  Response.json({
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        path,
        cost: 0.02,
        result: [{ total_count: items.length, items }],
      },
    ],
  });

// A linking page that points at the project's pricing page.
const linkPage = (href: string, rel = "") =>
  `<html><head><title>Swings</title></head><body><main><p>See <a href="${href}" ${rel ? `rel="${rel}"` : ""}>rope swings</a> for more.</p></main></body></html>`;
const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const deps = (impl: (url: string) => Response) => ({
  fetchImpl: async (url: string) => impl(url),
  validate: async (url: string) => url,
  robots: { allowed: async () => true },
});

const LINKING_PAGE = "https://swingblog.com/best-swings";
const TARGET = "https://shop.example.com/swings";

async function seedProspect() {
  await inWorkspace(() =>
    LinkGapService.run(person(), {
      competitors: [],
      mode: "partial",
      includeSingle: false,
      linkStatus: "live",
      includeSubdomains: true,
      rowLimit: 100,
    }),
  );
  const run = String(rows(`select id from link_gap_runs`)[0]?.id);
  await inWorkspace(() =>
    LinkEvidenceService.run(person(), {
      runId: run,
      domains: ["swingblog.com"],
    }),
  );
  await inWorkspace(() =>
    LinkProspectService.saveFromGap(person(), {
      runId: run,
      domains: ["swingblog.com"],
      campaignMode: "earned_editorial",
    }),
  );
  return String(rows(`select id from link_prospects`)[0]?.id);
}

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
  state.database?.exec(
    `insert into projects (id, organization_id, name, domain, location_code, language_code) values
       ('p1', 'org-cloud', 'Shop', 'shop.example.com', 2840, 'en'),
       ('p2', 'org-cloud', 'Other', 'other.example.com', 2840, 'en');
     insert into project_competitors (id, project_id, domain, updated_by) values
       ('c1', 'p1', 'rival.com', 'user'), ('c2', 'p1', 'rival2.com', 'user');
     insert into workspace_settings (organization_id, mode) values ('org-cloud', 'cloud')`,
  );
  providerFetch.mockImplementation(async (url) =>
    String(url instanceof Request ? url.url : url).includes(
      "domain_intersection",
    )
      ? task(
          ["v3", "backlinks", "domain_intersection", "live"],
          [
            {
              domain_intersection: {
                "1": entry("swingblog.com"),
                "2": entry("swingblog.com"),
              },
            },
          ],
        )
      : task(
          ["v3", "backlinks", "backlinks", "live"],
          [
            {
              type: "backlink",
              domain_from: "swingblog.com",
              url_from: LINKING_PAGE,
              url_to: "https://rival.com/swings",
              anchor: "rope swings",
              attributes: [],
              dofollow: true,
              page_from_title: "Best swings",
            },
          ],
        ),
  );
  vi.stubGlobal("fetch", providerFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("prospects", () => {
  it("saves a site once, and files a sponsored one as sponsored rather than earned", async () => {
    await seedProspect();
    const run = String(rows(`select id from link_gap_runs`)[0]?.id);
    const again = await inWorkspace(() =>
      LinkProspectService.saveFromGap(person(), {
        runId: run,
        domains: ["swingblog.com"],
        campaignMode: "earned_editorial",
      }),
    );
    expect(again).toMatchObject({ created: 0, alreadySaved: 1 });

    state.database?.exec(
      `update link_evidence set is_sponsored = 1 where project_id = 'p1'`,
    );
    state.database?.exec(`delete from link_prospects`);
    await inWorkspace(() =>
      LinkProspectService.saveFromGap(person(), {
        runId: run,
        domains: ["swingblog.com"],
        campaignMode: "earned_editorial",
      }),
    );
    expect(rows(`select campaign_mode from link_prospects`)).toEqual([
      { campaign_mode: "sponsored_distribution" },
    ]);
  });

  it("says so when no selected site is a valid public domain", async () => {
    await seedProspect();
    const run = String(rows(`select id from link_gap_runs`)[0]?.id);
    state.database?.exec(
      `update link_gap_candidates set referring_domain = 'swingblog.test'`,
    );
    await expect(
      inWorkspace(() =>
        LinkProspectService.saveFromGap(person(), {
          runId: run,
          domains: ["swingblog.test"],
          campaignMode: "earned_editorial",
        }),
      ),
    ).rejects.toThrow(/not valid public domains/);
  });
});

describe("outreach", () => {
  async function draftFor(prospectId: string) {
    await LinkProspectService.update(person(), {
      ids: [prospectId],
      patch: { targetUrl: TARGET },
    });
    return LinkOutreachService.generate(person(), { prospectId });
  }

  it("lets an agent write a draft but not approve it, and a person approves once per site", async () => {
    const prospectId = await seedProspect();
    const { draftId } = await inWorkspace(async () => {
      await LinkProspectService.update(agent(), {
        ids: [prospectId],
        patch: { targetUrl: TARGET },
      });
      return LinkOutreachService.generate(agent(), { prospectId });
    });
    await expect(
      inWorkspace(() => LinkOutreachService.approve(agent(), draftId)),
    ).rejects.toThrow(/needs a person/);
    await expect(
      inWorkspace(() => LinkOutreachService.markSent(agent(), draftId)),
    ).rejects.toThrow(/needs a person/);
    expect(rows(`select status from link_outreach_drafts`)).toEqual([
      { status: "draft" },
    ]);

    await inWorkspace(() => LinkOutreachService.approve(person(), draftId));
    expect(rows(`select status from link_prospects`)).toEqual([
      { status: "outreach_approved" },
    ]);
  });

  it("refuses a second unsent draft to the same site and honors the do-not-contact list", async () => {
    const prospectId = await seedProspect();
    const first = await inWorkspace(() => draftFor(prospectId));
    await expect(
      inWorkspace(() => LinkOutreachService.generate(person(), { prospectId })),
    ).rejects.toThrow(/already has an unsent draft/);

    await inWorkspace(() =>
      LinkOutreachService.withdraw(person(), first.draftId),
    );
    const second = await inWorkspace(() =>
      LinkOutreachService.generate(person(), { prospectId }),
    );
    await inWorkspace(() =>
      LinkOutreachService.addSuppression(person(), "swingblog.com"),
    );
    await expect(
      inWorkspace(() => LinkOutreachService.approve(person(), second.draftId)),
    ).rejects.toThrow(/do-not-contact/);
  });

  it("records a reply once", async () => {
    const prospectId = await seedProspect();
    const { draftId } = await inWorkspace(() => draftFor(prospectId));
    await inWorkspace(async () => {
      await LinkOutreachService.approve(person(), draftId);
      await LinkOutreachService.markSent(person(), draftId);
      await LinkOutreachService.logReply(person(), {
        draftId,
        outcome: "responded",
      });
    });
    await expect(
      inWorkspace(() =>
        LinkOutreachService.logReply(person(), {
          draftId,
          outcome: "declined",
        }),
      ),
    ).rejects.toThrow(/already recorded/);
  });

  it("exports only an approved draft", async () => {
    const prospectId = await seedProspect();
    const { draftId } = await inWorkspace(() => draftFor(prospectId));
    await expect(
      inWorkspace(() => LinkOutreachService.exportDraft(person(), draftId)),
    ).rejects.toThrow(/approved/);
  });
});

describe("link verification", () => {
  async function placement(prospectId: string | null = null) {
    const created = await inWorkspace(() =>
      LinkVerificationService.create(person(), {
        urlFrom: LINKING_PAGE,
        expectedTarget: TARGET,
        campaignMode: "earned_editorial",
        prospectId,
        state: "promised",
      }),
    );
    return created.placement.id;
  }

  it("confirms a real link, then records removal, and moves the prospect with it", async () => {
    const prospectId = await seedProspect();
    const id = await placement(prospectId);

    const live = await inWorkspace(() =>
      LinkVerificationService.verify(
        person(),
        id,
        deps(() => html(linkPage(TARGET))),
      ),
    );
    expect(live).toMatchObject({
      outcome: "confirmed",
      state: "confirmed_live",
    });
    expect(rows(`select status from link_prospects`)).toEqual([
      { status: "acquired" },
    ]);
    expect(
      rows(
        `select kind, status, publication_status, target_url from change_ledger_entries`,
      ),
    ).toEqual([
      {
        kind: "link_acquired",
        status: "executed",
        publication_status: "published",
        target_url: TARGET,
      },
    ]);

    const gone = await inWorkspace(() =>
      LinkVerificationService.verify(
        person(),
        id,
        deps(() => html("<html><body><p>Nothing here</p></body></html>")),
      ),
    );
    expect(gone).toMatchObject({
      outcome: "link_missing",
      state: "later_removed",
    });
    expect(rows(`select status from link_prospects`)).toEqual([
      { status: "lost" },
    ]);
    expect(rows(`select count(*) as n from link_placement_checks`)).toEqual([
      { n: 2 },
    ]);

    await inWorkspace(() =>
      LinkVerificationService.verify(
        person(),
        id,
        deps(() => html(linkPage(TARGET))),
      ),
    );
    expect(rows(`select count(*) as n from change_ledger_entries`)).toEqual([
      { n: 1 },
    ]);
  });

  it("does not call a link removed that was never seen, nor a failed fetch a removal", async () => {
    const id = await placement();
    const never = await inWorkspace(() =>
      LinkVerificationService.verify(
        person(),
        id,
        deps(() => html("<html><body>no link</body></html>")),
      ),
    );
    expect(never.state).toBe("promised");

    await inWorkspace(() =>
      LinkVerificationService.verify(
        person(),
        id,
        deps(() => html(linkPage(TARGET))),
      ),
    );
    const outage = await inWorkspace(() =>
      LinkVerificationService.verify(
        person(),
        id,
        deps(() => html("down", 503)),
      ),
    );
    expect(outage).toMatchObject({
      outcome: "unverifiable",
      state: "no_longer_verifiable",
    });
  });

  it("reports a sponsored link as sponsored and a changed destination", async () => {
    const id = await placement();
    await inWorkspace(() =>
      LinkVerificationService.verify(
        person(),
        id,
        deps(() => html(linkPage(TARGET, "sponsored nofollow"))),
      ),
    );
    expect(
      rows(`select is_sponsored, is_nofollow from link_placement_checks`),
    ).toEqual([{ is_sponsored: 1, is_nofollow: 1 }]);

    const moved = await inWorkspace(() =>
      LinkVerificationService.verify(
        person(),
        id,
        deps(() => html(linkPage("https://shop.example.com/other"))),
      ),
    );
    expect(moved.outcome).toBe("destination_changed");
  });

  it("never fetches a private address, and keeps projects apart", async () => {
    const fetchImpl = vi.fn(async () => html(linkPage(TARGET)));
    const created = await inWorkspace(() =>
      LinkVerificationService.create(person(), {
        urlFrom: "http://127.0.0.1/admin",
        expectedTarget: TARGET,
        campaignMode: "earned_editorial",
        state: "promised",
      }),
    );
    const result = await inWorkspace(() =>
      LinkVerificationService.verify(person(), created.placement.id, {
        fetchImpl,
        robots: { allowed: async () => true },
      }),
    );
    expect(result.outcome).toBe("unverifiable");
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      inWorkspace(() =>
        LinkVerificationService.verify(person("p2"), created.placement.id),
      ),
    ).rejects.toThrow(/not found/);
    await expect(
      inWorkspace(() =>
        LinkVerificationService.create(person(), {
          urlFrom: LINKING_PAGE,
          expectedTarget: "https://elsewhere.com/page",
          campaignMode: "earned_editorial",
          state: "promised",
        }),
      ),
    ).rejects.toThrow(/must be on/);
  });

  it("records one placement per link and counts only confirmed ones in the report", async () => {
    const id = await placement();
    expect(await placement()).toBe(id);
    expect((await LinkReportService.report("p1")).confirmedLive).toBe(0);
    await inWorkspace(() =>
      LinkVerificationService.verify(
        person(),
        id,
        deps(() => html(linkPage(TARGET))),
      ),
    );
    expect(await LinkReportService.report("p1")).toMatchObject({
      confirmedLive: 1,
      verifiedReferringDomains: 1,
      earnedLive: 1,
      sponsoredLive: 0,
    });
  });
});
