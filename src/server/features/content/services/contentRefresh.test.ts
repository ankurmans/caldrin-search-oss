import { beforeEach, expect, it, vi } from "vitest";
import { ContentRefusal } from "../rules/contentRefusal";
import {
  executeContentRefresh,
  listContentRefresh,
  queueContentRefresh,
  retryContentRefresh,
} from "./contentRefreshQueue";
import { writeOpportunityRefresh } from "./contentRefresh";
import { ContentRepository } from "../repositories/ContentRepository";

const { testDb, write, start } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../../ai-visibility/aiVisibilityTestDb");
  return {
    testDb: await createAiVisibilityTestDb(),
    write: vi.fn(),
    start: vi.fn<(run: { id: string }) => Promise<unknown>>(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE_PROVIDER: "d1",
    AUTH_MODE: "password",
    AI_VISIBILITY_WORKFLOW: { create: start },
  },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/features/source-gap/sourcePageFetcher", () => ({
  fetchSourcePage: async (url: string) => ({
    status: "ok",
    finalUrl: url,
    html: `<html><head><title>Current guide</title></head><body><article><h1>Current guide</h1><p>${"This is the published guide with original facts and instructions. ".repeat(30)}</p></article></body></html>`,
  }),
}));
vi.mock("@/server/features/keywords/services/research/serp", () => ({
  getStoredSerp: async () => null,
}));
vi.mock("./writeEditorialDraft", () => ({ writeEditorialDraft: write }));

beforeEach(() => {
  vi.clearAllMocks();
});

it("keeps the imported page as the first revision and saves the AI edit as a draft", async () => {
  await testDb.seedProject();
  await testDb.client.execute(`INSERT INTO content_opportunities
    (id, project_id, organization_id, dedupe_key, query, page_url, impressions, clicks, ctr, position, window_start, window_end, recommended_action, reason, data_source)
    VALUES ('refresh', 'project', 'organization', 'refresh', 'Improve the current guide', 'https://caldrin.co/guide', 20, 1, 0.05, 11, '2026-11-01', '2026-11-23', 'refresh_existing_page', 'A relevant buyer question', 'simulated')`);
  write.mockResolvedValue({
    draft: {
      title: "Updated guide",
      bodyHtml: "<p>Updated copy.</p>",
      metaTitle: "Updated guide",
      metaDescription: "Summary",
    },
  });
  const scope = {
    projectId: "project",
    organizationId: "organization",
    userId: "writer",
    userEmail: "writer@example.com",
  };
  const project = {
    domain: "caldrin.co",
    locationCode: 2840,
    languageCode: "en",
  };
  const result = await writeOpportunityRefresh(scope, "refresh", project);
  expect(result.written).toBe(true);
  expect(
    await ContentRepository.getAsset("project", result.assetId),
  ).toMatchObject({
    opportunityId: "refresh",
    importedFrom: "https://caldrin.co/guide",
    title: "Updated guide",
    status: "draft",
    approvedRevision: null,
    revision: 2,
  });
  expect(await ContentRepository.listVersions(result.assetId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        revision: 1,
        bodyHtml: expect.stringContaining("published guide") as unknown,
      }),
      expect.objectContaining({
        revision: 2,
        bodyHtml: "<p>Updated copy.</p>",
      }),
    ]),
  );
  await expect(
    writeOpportunityRefresh(scope, "refresh", project),
  ).rejects.toThrow("Choose an open opportunity");
  expect(write).toHaveBeenCalledOnce();
});

it("persists one job per page, and retries the imported revision without writing a second baseline", async () => {
  await testDb.seedProject();
  await testDb.client.executeMultiple(`
    INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('writer','Writer','writer@example.com',1,0,0);
    INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES ('writer-member','organization','writer','owner',0);
    INSERT INTO content_opportunities
      (id,project_id,organization_id,dedupe_key,query,page_url,impressions,clicks,ctr,position,window_start,window_end,recommended_action,reason,data_source)
      VALUES ('queued-refresh','project','organization','queued-refresh','Improve the published guide','https://caldrin.co/guide',20,1,0.05,11,'2026-11-01','2026-11-23','refresh_existing_page','A relevant buyer question','simulated');`);
  const scope = {
    projectId: "project",
    organizationId: "organization",
    userId: "writer",
  };
  start.mockResolvedValue({});
  write.mockRejectedValueOnce(
    new ContentRefusal("Provider temporarily unavailable."),
  );
  write.mockResolvedValueOnce({
    draft: {
      title: "Updated guide",
      bodyHtml: "<p>Updated copy.</p>",
      metaTitle: "Updated guide",
      metaDescription: "",
    },
  });
  expect(await queueContentRefresh(scope, ["queued-refresh"])).toEqual({
    queued: 1,
  });
  expect(await queueContentRefresh(scope, ["queued-refresh"])).toEqual({
    queued: 0,
  });
  expect(write).not.toHaveBeenCalled();
  const [{ id }] = await listContentRefresh("project");
  expect(await listContentRefresh("another-project")).toEqual([]);
  const first = start.mock.calls[0][0].id;
  await Promise.all([
    executeContentRefresh(first, id),
    executeContentRefresh(first, id),
  ]);
  expect(await listContentRefresh("project")).toMatchObject([
    { status: "failed", assetId: "refresh-queued-refresh" },
  ]);
  await retryContentRefresh(scope, id);
  const second = start.mock.calls[1][0].id;
  await executeContentRefresh(second, id);
  expect(await listContentRefresh("project")).toMatchObject([
    { status: "ready", assetId: "refresh-queued-refresh" },
  ]);
  expect(
    await ContentRepository.listVersions("refresh-queued-refresh"),
  ).toHaveLength(2);
  expect(write).toHaveBeenCalledTimes(2);
});
