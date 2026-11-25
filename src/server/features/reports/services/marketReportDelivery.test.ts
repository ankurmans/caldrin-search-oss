import { expect, it, vi } from "vitest";
import {
  deliverScheduledMarketReports,
  getMarketReportDelivery,
  scheduleMarketReport,
} from "./marketReportDelivery";

const { testDb, send, save } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../../ai-visibility/aiVisibilityTestDb");
  return {
    testDb: await createAiVisibilityTestDb(),
    send: vi.fn(),
    save: vi.fn(),
  };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1", BETTER_AUTH_URL: "https://reports.example" },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/email/ses", () => ({
  isSesConfigured: () => true,
  sendSesEmail: send,
}));
vi.mock("./MarketReportService", () => ({
  getReportMarkets: async () => [{ key: "2840:en" }, { key: "2826:en" }],
  saveMarketComparison: save,
}));

it("delivers one private link per due schedule and skips a teammate after their project access is revoked", async () => {
  await testDb.seedProject();
  await testDb.client.executeMultiple(`
    INSERT INTO user(id, name, email, email_verified, created_at, updated_at)
    VALUES ('owner', 'Owner', 'owner@example.com', 1, 0, 0), ('client', 'Client', 'client@example.com', 1, 0, 0);
    INSERT INTO member(id, organization_id, user_id, role, created_at)
    VALUES ('owner-member', 'organization', 'owner', 'owner', 0),
      ('client-member', 'organization', 'client', 'project_member', 0);
    INSERT INTO project_access(organization_id,user_id,project_id)
    VALUES ('organization','client','project');
  `);
  save.mockResolvedValue({ reportId: "report-id" });
  const input = {
    projectId: "project",
    emailVerified: true,
    days: 28 as const,
    cadence: 7 as const,
    markets: [
      { locationCode: 2840, languageCode: "en" },
      { locationCode: 2826, languageCode: "en" },
    ],
  };
  await scheduleMarketReport({ ...input, userId: "owner" });
  await scheduleMarketReport({ ...input, userId: "client" });
  await testDb.client.execute(
    "DELETE FROM project_access WHERE user_id='client'",
  );
  const due = new Date(Date.now() + 8 * 86_400_000);
  await Promise.all([
    deliverScheduledMarketReports(due),
    deliverScheduledMarketReports(due),
  ]);
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: "owner@example.com",
      text: expect.stringContaining(
        "https://reports.example/p/project/reports/report-id",
      ) as unknown,
    }),
  );
  expect(
    (await getMarketReportDelivery("project", "owner")).schedule,
  ).toMatchObject({ lastStatus: "Sent", lastReportId: "report-id" });
  expect(
    (await getMarketReportDelivery("project", "client")).schedule,
  ).toMatchObject({ lastStatus: "Skipped because project access changed" });
});
