import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestServerEvents } from "./attributionApiIngest";
import { getAttributionOverview } from "./attributionReports";
import {
  createPosthogConnector,
  importPosthog,
  reusablePosthogKey,
} from "./attributionPosthog";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../../ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/secret-box", () => ({
  sealSecret: async (v: string) => `sealed:${v}`,
  openSecret: async (v: string) => v.replace("sealed:", ""),
}));

const KEY = "phx_abcdefghijklmnopqrstuvwxyz0123";
const credentials = {
  label: "Product analytics",
  region: "us",
  posthogProjectId: "666216",
  apiKey: KEY,
} as const;
const DAY = 86_400;
const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 6 * DAY * 1000)
  .toISOString()
  .slice(0, 10);
const at = (hoursAgo: number) =>
  Math.floor(Date.now() / 1000 - hoursAgo * 3600);

/** A row in the order the import query selects its columns. */
const view = (v: {
  uuid: string;
  distinct: string;
  session: string;
  url: string;
  referrer: string | null;
  hoursAgo: number;
}) => [
  v.uuid,
  "$pageview",
  at(v.hoursAgo),
  v.distinct,
  v.session,
  v.url,
  v.referrer,
  null,
  null,
  null,
  null,
  null,
  null,
  "Mozilla/5.0",
];
const identify = (
  uuid: string,
  anon: string,
  user: string,
  hoursAgo: number,
) => [
  uuid,
  "$identify",
  at(hoursAgo),
  user,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  anon,
  "Mozilla/5.0",
];

const rows = [
  view({
    uuid: "a1",
    distinct: "anon-1",
    session: "s1",
    url: "https://example.com/?utm_source=g&utm_medium=cpc",
    referrer: "https://www.google.com/",
    hoursAgo: 60,
  }),
  identify("a2", "anon-1", "user-1", 50),
  // PostHog recorded nothing about where this visit came from
  view({
    uuid: "b1",
    distinct: "anon-2",
    session: "s2",
    url: "https://example.com/pricing",
    referrer: null,
    hoursAgo: 58,
  }),
  identify("b2", "anon-2", "user-2", 49),
  view({
    uuid: "c1",
    distinct: "anon-3",
    session: "s3",
    url: "https://elsewhere.test/",
    referrer: "$direct",
    hoursAgo: 57,
  }),
];

const paid = (user: string) => ({
  event_id: `pay-${user}`,
  type: "payment" as const,
  user_id: user,
  customer_id: `c-${user}`,
  amount_minor: 1000,
  currency: "USD",
  occurred_at: new Date().toISOString(),
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

async function connect() {
  fetchMock.mockResolvedValueOnce(
    Response.json({ results: [["$pageview", 3]] }),
  );
  return (await createPosthogConnector("project", credentials)).id;
}
const importRows = (id: string, dryRun: boolean) => {
  fetchMock.mockResolvedValueOnce(Response.json({ results: rows }));
  return importPosthog("project", id, { from: weekAgo, to: today, dryRun });
};

beforeEach(async () => {
  await testDb.seedProject();
  await ledger.insertProperty({
    id: "prop",
    projectId: "project",
    name: "Site",
    host: "example.com",
    createdAt: new Date().toISOString(),
  });
});

describe("PostHog import", () => {
  it("previews without writing, then imports once however often the range is read", async () => {
    const id = await connect();

    const preview = await importRows(id, true);
    expect(preview).toMatchObject({
      imported: null,
      wouldAdd: 4,
      alreadyHeld: 0,
    });
    expect(preview.unregistered).toEqual({ "elsewhere.test": 1 });
    expect(await ledger.countPending("project")).toBe(0);

    expect(await importRows(id, false)).toMatchObject({
      imported: { accepted: 4, duplicate: 0 },
    });
    expect(await importRows(id, false)).toMatchObject({
      imported: { accepted: 0, duplicate: 4 },
    });
  });

  it("marks the registered website as receiving traffic once PostHog events land", async () => {
    const id = await connect();
    expect((await ledger.listProperties("project"))[0]?.verifiedAt).toBeNull();

    await importRows(id, false);

    expect(
      (await ledger.listProperties("project"))[0]?.verifiedAt,
    ).toBeTruthy();
  });

  it("credits a payment to the campaign PostHog recorded, and leaves one with nothing recorded Unknown", async () => {
    const id = await connect();
    await importRows(id, false);
    await ingestServerEvents("project", [paid("user-1"), paid("user-2")]);

    const { channels } = await getAttributionOverview({
      projectId: "project",
      range: "28d",
      demo: false,
    });

    expect(channels.find((c) => c.channel === "paid")?.revenue).toEqual([
      { currency: "USD", minor: 1000 },
    ]);
    expect(channels.find((c) => c.channel === "unknown")?.revenue).toEqual([
      { currency: "USD", minor: 1000 },
    ]);
    expect(channels.find((c) => c.channel === "direct")).toBeUndefined();
  });

  it("sends the key only to PostHog's own host and never repeats it in an error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 }));

    const failure = await createPosthogConnector("project", credentials).catch(
      (e: Error) => e,
    );

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toMatch(
      /^https:\/\/us\.posthog\.com\//,
    );
    expect(failure).toHaveProperty("message", expect.not.stringContaining(KEY));
  });

  it("refuses a range over 31 days, so a backfill is always a deliberate step", async () => {
    const id = await connect();

    await expect(
      importPosthog("project", id, {
        from: "2026-01-01",
        to: "2026-03-01",
        dryRun: true,
      }),
    ).rejects.toThrow("at most 31 days");
  });
});

describe("reusing a PostHog key", () => {
  it("lets a sibling project in the workspace connect without pasting the key, and never across workspaces", async () => {
    await connect();
    await testDb.client.executeMultiple(`
      INSERT INTO organization (id, name, slug, created_at) VALUES ('other-org', 'Other', 'other', 0);
      INSERT INTO projects (id, organization_id, name, domain) VALUES
        ('sibling', 'organization', 'Sibling', 'sibling.test'),
        ('outsider', 'other-org', 'Outsider', 'outsider.test');
    `);

    expect(await reusablePosthogKey("sibling")).toEqual({
      projectName: "Caldrin Search",
      region: "us",
    });
    expect(await reusablePosthogKey("outsider")).toBeNull();

    fetchMock.mockResolvedValueOnce(Response.json({ results: [] }));
    await createPosthogConnector("sibling", {
      label: "Second",
      posthogProjectId: "700088",
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://us.posthog.com/api/projects/700088/query/",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: `Bearer ${KEY}`,
        }) as unknown,
      }),
    );
    await expect(
      createPosthogConnector("outsider", {
        label: "No key",
        posthogProjectId: "1",
      }),
    ).rejects.toThrow("Paste a PostHog personal API key");
  });
});
