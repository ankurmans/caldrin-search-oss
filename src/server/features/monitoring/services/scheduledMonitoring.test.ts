import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendSesEmail } from "@/server/email/ses";
import { AiMeasurementRepository } from "@/server/features/ai-visibility/repositories/aiMeasurementRepository";
import { AiVisibilityRepository as aiRepo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { ensurePromptSetVersion } from "@/server/features/ai-visibility/services/aiPromptSetVersions";
import {
  seedMeasurementRun,
  type Answer,
} from "@/server/features/ai-visibility/services/aiMeasurementTestSeed";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { z } from "zod";
import { alertDetailsSchema } from "../types";
import { MonitoringRepository } from "../repositories/MonitoringRepository";
import { MonitoringService } from "./MonitoringService";
import { saveAlertDestinations } from "./monitoringDestinations";
import { runScheduledMonitoring } from "./scheduledMonitoring";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/secret-box", () => ({
  sealSecret: async (value: string) => `sealed:${btoa(value)}`,
  openSecret: async (value: string) => atob(value.slice("sealed:".length)),
}));
// SES counts as configured, so only the workspace's destination decides delivery.
vi.mock("@/server/email/ses", () => ({
  isSesConfigured: () => true,
  sendSesEmail: vi.fn(),
}));

// Tuesday of ISO week 2026-W47; the last complete week is 2026-W46.
const NOW = new Date("2026-11-17T03:17:00.000Z");
const DAY_1 = "2026-11-14T10:00:00.000Z";
const DAY_2 = "2026-11-15T10:00:00.000Z";

let context: { trackerId: string; promptIds: string[]; versionId: string };

async function trackProject(projectId: string) {
  const rows = configuration(
    {
      engines: ["chatgpt", "gemini"],
      prompts: [{ text: "Which SEO tools?" }, { text: "Best rank tracker?" }],
    },
    projectId,
  );
  await aiRepo.saveConfiguration(rows);
  const promptIds = rows.prompts.map((p) => p.id);
  return {
    trackerId: rows.tracker.id,
    promptIds,
    versionId: await ensurePromptSetVersion(rows.tracker.id, promptIds),
  };
}

const seedRun = (
  answers: Answer[],
  options: Parameters<typeof seedMeasurementRun>[3] = {},
) => seedMeasurementRun(testDb.db, context, answers, options);

/** Own brand named in 1 of 2 answers on day one and 2 of 2 on day two. */
async function seedMentionRise() {
  await seedRun([{ prompt: 0, mentioned: true }, { prompt: 1 }], {
    createdAt: DAY_1,
  });
  await seedRun(
    [
      { prompt: 0, mentioned: true },
      { prompt: 1, mentioned: true },
    ],
    { createdAt: DAY_2 },
  );
}

const alerts = async (projectId = "project") =>
  (await MonitoringService.listAlerts(projectId, { limit: 100, offset: 0 }))
    .alerts;
const alertsOfKind = async (kind: string) =>
  (await alerts()).filter((alert) => alert.kind === kind);
const rows = async (sql: string) =>
  (await testDb.client.execute(sql)).rows.map((row) => ({ ...row }));

const addOwner = () =>
  testDb.client.executeMultiple(`
    INSERT OR IGNORE INTO user (id, name, email) VALUES ('owner', 'Owner', 'owner@example.com');
    INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES ('owner-member', 'organization', 'owner', 'owner', 0);
  `);

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
  await testDb.seedProject();
  context = await trackProject("project");
});

describe("runScheduledMonitoring", () => {
  it("writes an alert for a comparable change with its counts, conditions and verdict", async () => {
    await seedMentionRise();

    await runScheduledMonitoring(NOW);

    const [alert] = await alertsOfKind("visibility_change");
    expect(alert.body).toContain(
      "Own-brand mention rate: 1/2 (50%) → 2/2 (100%); too few runs to judge.",
    );
    expect(alert.body).not.toContain("Own-domain citation rate");
    expect(alert.comparable).toBe(true);
    expect(alert.conditions).toMatchObject({
      promptSetVersion: 1,
      engines: ["chatgpt"],
      markets: ["2840:en"],
      before: { period: "2026-11-14", runs: 1, answered: 2 },
      after: { period: "2026-11-15", runs: 1, answered: 2 },
    });
    const [{ details_json: stored }] = await rows(
      "SELECT details_json FROM project_alerts WHERE kind = 'visibility_change'",
    );
    expect(
      alertDetailsSchema.parse(JSON.parse(z.string().parse(stored))).metrics,
    ).toEqual([
      {
        metric: "own_mention_rate",
        subject: "own",
        before: { numerator: 1, denominator: 2 },
        after: { numerator: 2, denominator: 2 },
        difference: 0.5,
        verdict: "insufficient_runs",
      },
    ]);
    // Nothing else moved, so nothing else is written.
    expect(await alertsOfKind("competitor_change")).toEqual([]);
    expect(await alertsOfKind("source_change")).toEqual([]);
  });

  it("names a cited domain that entered the top list", async () => {
    await seedRun([{ prompt: 0 }, { prompt: 1 }], { createdAt: DAY_1 });
    await seedRun(
      [{ prompt: 0, sources: ["https://docs.example/a"] }, { prompt: 1 }],
      { createdAt: DAY_2 },
    );

    await runScheduledMonitoring(NOW);

    const [alert] = await alertsOfKind("source_change");
    expect(alert.body).toContain(
      "docs.example entered the top cited domains; answers citing it: 0/2 (0%) → 1/2 (50%); too few runs to judge.",
    );
  });

  it.each([
    [
      "prompt-set",
      async () =>
        ensurePromptSetVersion(context.trackerId, [context.promptIds[0]]),
      {},
    ],
    [
      "engine-set",
      async () => context.versionId,
      { engine: "gemini" as const },
    ],
  ])(
    "writes no change alert across a %s change",
    async (_label, secondVersion, answer) => {
      await seedRun([{ prompt: 0, mentioned: false }], { createdAt: DAY_1 });
      await seedRun([{ prompt: 0, mentioned: true, ...answer }], {
        createdAt: DAY_2,
        version: await secondVersion(),
      });

      await runScheduledMonitoring(NOW);

      expect(
        (await alerts()).filter((a) => a.kind !== "weekly_summary"),
      ).toEqual([]);
      expect(
        await rows(
          "SELECT status FROM monitoring_job_runs WHERE job = 'ai_visibility_changes'",
        ),
      ).toEqual([{ status: "skipped" }]);
    },
  );

  it("does nothing new when re-run in the same period", async () => {
    await seedMentionRise();

    await runScheduledMonitoring(NOW);
    const first = await alerts();
    await runScheduledMonitoring(new Date(NOW.getTime() + 3_600_000));

    expect(await alerts()).toEqual(first);
    expect(
      await rows("SELECT job, attempt FROM monitoring_job_runs ORDER BY job"),
    ).toEqual([
      { job: "ai_visibility_changes", attempt: 1 },
      { job: "ai_visibility_weekly_summary", attempt: 1 },
    ]);
  });

  it("stops retrying a failing job after three attempts and alerts once", async () => {
    await seedMentionRise();
    const read = vi
      .spyOn(AiMeasurementRepository, "getAnswerFacts")
      .mockRejectedValue(new Error("database unavailable"));

    for (let pass = 0; pass < 3; pass++) await runScheduledMonitoring(NOW);
    const calls = read.mock.calls.length;
    await runScheduledMonitoring(NOW);

    expect(read.mock.calls.length).toBe(calls);
    expect(
      await rows(
        "SELECT job, status, attempt FROM monitoring_job_runs ORDER BY job",
      ),
    ).toEqual([
      { job: "ai_visibility_changes", status: "failed", attempt: 3 },
      { job: "ai_visibility_weekly_summary", status: "failed", attempt: 3 },
    ]);
    // One per failing job, however many attempts failed.
    expect(await alertsOfKind("run_failed")).toHaveLength(2);
  });

  it("writes the weekly summary once per ISO week", async () => {
    await seedMentionRise();

    await runScheduledMonitoring(NOW);
    await runScheduledMonitoring(new Date("2026-11-20T03:17:00.000Z"));

    const summaries = await alertsOfKind("weekly_summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].title).toBe("Weekly AI visibility summary: 2026-W46");
    expect(summaries[0].body).toContain("Own-brand mention rate: 3/4 (75%).");
    expect(summaries[0].body).toContain("Not compared with week 2026-W45");
  });

  it("never lists or marks one project's alerts for another", async () => {
    await testDb.client.executeMultiple(`
      INSERT INTO organization (id, name, slug, created_at)
        VALUES ('organization-b', 'B', 'b', 0);
      INSERT INTO projects (id, organization_id, name, domain)
        VALUES ('other', 'organization-b', 'Other', 'other.example');
    `);
    await seedMentionRise();
    const other = await trackProject("other");
    await seedMeasurementRun(testDb.db, other, [{ prompt: 0 }], {
      createdAt: DAY_1,
      project: "other",
    });

    await runScheduledMonitoring(NOW);

    const own = await alerts("project");
    const others = await alerts("other");
    expect(own.length).toBeGreaterThan(0);
    expect(others.map((a) => a.kind)).toEqual(["weekly_summary"]);
    expect(own.map((a) => a.id)).not.toContain(others[0].id);
    await MonitoringService.markRead(
      "other",
      own.map((a) => a.id),
    );
    expect((await alerts("project")).every((a) => a.readAt === null)).toBe(
      true,
    );
  });

  it("sends nothing outside the app until the workspace chooses a destination", async () => {
    await addOwner();
    await seedMentionRise();

    await runScheduledMonitoring(NOW);

    expect(await alerts()).not.toEqual([]);
    expect(sendSesEmail).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect((await alerts()).every((a) => a.emailedAt === null)).toBe(true);
  });

  it("emails the owners and stamps emailed_at when the workspace turns email on", async () => {
    await addOwner();
    await saveAlertDestinations("organization", { emailEnabled: true });
    await seedMentionRise();

    await runScheduledMonitoring(NOW);

    expect(sendSesEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@example.com" }),
    );
    expect((await alerts()).every((a) => a.emailedAt !== null)).toBe(true);
  });

  it("posts new alerts to the saved Slack webhook and only to Slack's host", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok"));
    await saveAlertDestinations("organization", {
      emailEnabled: false,
      slackWebhookUrl: "https://hooks.slack.com/services/T1/B1/x",
    });
    await seedMentionRise();

    await runScheduledMonitoring(NOW);

    expect(sendSesEmail).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0);
    for (const [url] of vi.mocked(fetch).mock.calls)
      expect(url).toBe("https://hooks.slack.com/services/T1/B1/x");
    // The webhook is never stored in the clear.
    const row = await MonitoringRepository.getDestinations("organization");
    expect(row?.slackWebhookSealed).not.toContain(
      "hooks.slack.com/services/T1",
    );
  });

  it("refuses a webhook that is not a Slack URL", async () => {
    await expect(
      saveAlertDestinations("organization", {
        emailEnabled: false,
        slackWebhookUrl: "https://example.com/services/T1/B1/x",
      }),
    ).rejects.toThrow(/Slack/);
  });

  it("makes no network call", async () => {
    await seedMentionRise();

    await runScheduledMonitoring(NOW);

    expect(await alerts()).not.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
