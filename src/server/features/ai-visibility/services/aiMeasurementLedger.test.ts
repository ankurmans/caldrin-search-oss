import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_NOTE,
  type RecordObservationInput,
} from "@/server/features/ledger/types";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { ensurePromptSetVersion } from "./aiPromptSetVersions";
import { linkRunsToLedger } from "./aiMeasurementLedger";
import { seedMeasurementRun, type Answer } from "./aiMeasurementTestSeed";
import { configuration } from "./aiVisibilityTestFixtures";

const { testDb, ledger } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return {
    testDb: await createAiVisibilityTestDb(),
    ledger: {
      getEntry: vi.fn(),
      recordObservation: vi.fn(
        async (_scope: unknown, _entryId: string, _o: RecordObservationInput) =>
          undefined,
      ),
    },
  };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/features/ledger/services/LedgerService", () => ({
  LedgerService: ledger,
}));

const scope = {
  projectId: "project",
  organizationId: "organization",
  userId: "user",
};
const executedAt = "2026-10-10T00:00:00.000Z";
const before = "2026-10-01T00:00:00.000Z";
const after = "2026-10-20T00:00:00.000Z";

let context: { trackerId: string; promptIds: string[]; versionId: string };
const seed = (answers: Answer[], createdAt: string) =>
  seedMeasurementRun(testDb.db, context, answers, { createdAt });
const entry = (overrides = {}, observations: unknown[] = []) =>
  ledger.getEntry.mockResolvedValue({
    entry: { executedAt, publicationStatus: "published", ...overrides },
    observations,
  });

beforeEach(async () => {
  await testDb.seedProject();
  const rows = configuration({
    engines: ["chatgpt"],
    prompts: [{ text: "Which SEO tools?" }, { text: "Best rank tracker?" }],
  });
  await repo.saveConfiguration(rows);
  const promptIds = rows.prompts.map((p) => p.id);
  context = {
    trackerId: rows.tracker.id,
    promptIds,
    versionId: await ensurePromptSetVersion(rows.tracker.id, promptIds),
  };
  entry();
});

const pair = (mentioned: boolean) => [
  { prompt: 0, mentioned },
  { prompt: 1, mentioned: false },
];

describe("linkRunsToLedger", () => {
  it("records each run's rates as observations that claim no cause, once", async () => {
    const baseline = await seed(pair(false), before);
    const followUp = await seed(pair(true), after);
    const input = {
      entryId: "entry",
      baselineRunIds: [baseline],
      followUpRunIds: [followUp],
    };

    const result = await linkRunsToLedger(scope, input);

    // The recommendation metric is skipped: no answer stated a verdict.
    expect(result).toMatchObject({ recorded: 4, attribution: "observed_only" });
    expect(ledger.recordObservation).toHaveBeenCalledWith(
      scope,
      "entry",
      expect.objectContaining({
        phase: "follow_up",
        source: "ai_visibility",
        metric: "ai_own_mention_rate",
        value: 0.5,
        numerator: 1,
        denominator: 2,
        aiRunId: followUp,
        windowStart: after,
      }),
    );
    const recorded = ledger.recordObservation.mock.calls.map((call) => call[2]);
    expect(recorded.every((o) => o.note?.includes(ATTRIBUTION_NOTE))).toBe(
      true,
    );

    entry({}, recorded);
    ledger.recordObservation.mockClear();
    expect(await linkRunsToLedger(scope, input)).toMatchObject({
      recorded: 0,
      skipped: 4,
    });
    expect(ledger.recordObservation).not.toHaveBeenCalled();
  });

  it("refuses runs that are not like-for-like and records nothing", async () => {
    const baseline = await seed(pair(false), before);
    const legacy = await seedMeasurementRun(testDb.db, context, pair(true), {
      createdAt: after,
      version: null,
    });

    await expect(
      linkRunsToLedger(scope, {
        entryId: "entry",
        baselineRunIds: [baseline],
        followUpRunIds: [legacy],
      }),
    ).rejects.toThrow(/not like-for-like/);
    expect(ledger.recordObservation).not.toHaveBeenCalled();
  });

  it("refuses a baseline collected after the change and an unpublished change", async () => {
    const early = await seed(pair(false), before);
    const late = await seed(pair(false), after);
    const input = {
      entryId: "entry",
      baselineRunIds: [late],
      followUpRunIds: [early],
    };

    await expect(linkRunsToLedger(scope, input)).rejects.toThrow(
      /baseline run was collected after/,
    );
    entry({ publicationStatus: "draft" });
    await expect(
      linkRunsToLedger(scope, {
        entryId: "entry",
        baselineRunIds: [early],
        followUpRunIds: [late],
      }),
    ).rejects.toThrow(/not published/);
    expect(ledger.recordObservation).not.toHaveBeenCalled();
  });
});
