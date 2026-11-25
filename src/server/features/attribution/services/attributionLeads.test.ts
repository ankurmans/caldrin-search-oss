import { beforeEach, describe, expect, it, vi } from "vitest";
import { importAdapterRecords } from "./attributionAdapterImport";
import { ingestServerEvents } from "./attributionApiIngest";
import { getCallsReport } from "./attributionCalls";
import { drainAttribution } from "./attributionDrain";
import { compareAttributionModels } from "./attributionReports";
import { getLeadsReport } from "./attributionLeads";
import { getBrandRouting } from "./attributionRouting";
import {
  basementCallRecords,
  basementFormEvents,
  basementJobRecords,
  LUMA_BRANDS,
  LUMA_ENQUIRIES,
  LUMA_UNKNOWN_SOURCES,
  lumaCrmRecords,
} from "./attributionScenarios.fixtures";
import {
  addAttributionBrand,
  addAttributionSourceRule,
} from "./attributionSetup";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../../ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

const query = { projectId: "project", range: "28d", demo: false } as const;

const load = async (
  kind: "crm" | "calls",
  system: string,
  records: unknown[],
) => {
  const result = await importAdapterRecords("project", {
    kind,
    system,
    records,
    dryRun: false,
  });
  await drainAttribution("project", 1000);
  return result;
};

beforeEach(async () => {
  await testDb.seedProject();
});

describe("multi-brand B2B enquiries (synthetic scenario)", () => {
  beforeEach(async () => {
    for (const name of LUMA_BRANDS) await addAttributionBrand("project", name);
    await load("crm", "luma crm", lumaCrmRecords());
  });

  it("reads each enquiry's furthest stage and keeps value, cash and pipeline apart", async () => {
    const report = await getLeadsReport(query);
    expect(report.totals).toMatchObject({
      enquiries: LUMA_ENQUIRIES,
      byStage: { enquiry: 116, qualified: 24, booked: 5, won: 5, lost: 5 },
      duplicateSubjects: 7,
    });
    expect(report.value.contract).toEqual([
      { currency: "USD", minor: 3_500_000 },
    ]);
    expect(report.value.collected).toEqual([
      { currency: "USD", minor: 1_050_000 },
    ]);
    expect(report.value.pipeline).toEqual([
      { currency: "USD", minor: 7_625_000 },
    ]);
  });

  it("keeps the words of enquirers with no source and reads Google as search of unspecified type", async () => {
    const report = await getLeadsReport({ ...query, model: "self_reported" });
    expect(report.totals.withoutOwnWords).toBe(LUMA_UNKNOWN_SOURCES);
    expect(report.selfReported.map((p) => p.text)).toContain(
      "Googled you and found your site",
    );
    const google = report.selfReported.filter((p) => /google/i.test(p.text));
    expect(google.every((p) => p.read.channel === "search_unspecified")).toBe(
      true,
    );
    expect(report.bySource.map((s) => s.channel)).not.toContain(
      "organic_search",
    );
    expect(report.bySource.map((s) => s.channel)).toContain(
      "search_unspecified",
    );
  });

  it("lists enquiries received by the wrong brand without overwriting the receiving brand", async () => {
    const routing = await getBrandRouting(query);
    const cell = (receivedBrand: string, intendedBrand: string) =>
      routing.matrix.find(
        (m) =>
          m.receivedBrand === receivedBrand &&
          m.intendedBrand === intendedBrand,
      )?.count;
    expect(cell("Luma Creative", "Westwave AV")).toBe(21);
    expect(cell("Westwave AV", "Luma Creative")).toBe(8);
    expect(routing.totals.misrouted).toBe(29);
    expect(
      routing.misrouted.every((m) => m.receivedBrand !== m.intendedBrand),
    ).toBe(true);
    expect(routing.byEffectiveBrand.reduce((n, b) => n + b.enquiries, 0)).toBe(
      LUMA_ENQUIRIES,
    );
  });

  it("flags a channel the models disagree on as model-dependent", async () => {
    const lead = await compareAttributionModels({ ...query, kind: "lead" });
    const unknown = lead.rows.find((r) => r.channel === "unknown");
    const search = lead.rows.find((r) => r.channel === "search_unspecified");
    expect(unknown?.modelDependent).toBe(true);
    expect(search?.high).toBeGreaterThan(search?.low ?? Infinity);
  });

  it("adds nothing when the same export is sent again, and reports bad records by position", async () => {
    const again = await importAdapterRecords("project", {
      kind: "crm",
      system: "luma crm",
      records: lumaCrmRecords(),
      dryRun: false,
    });
    expect(again.imported).toMatchObject({
      accepted: 0,
      duplicate: again.events,
    });

    const bad = await importAdapterRecords("project", {
      kind: "crm",
      system: "luma crm",
      records: [
        {
          record_type: "deal",
          id: "D-open",
          stage: "open",
          created_at: "2026-11-01T00:00:00Z",
        },
        { record_type: "lead", id: "no-date" },
      ],
      dryRun: true,
    });
    expect(bad).toMatchObject({ events: 0, skipped: 1 });
    expect(bad.errors).toEqual([expect.objectContaining({ index: 1 })]);
  });
});

describe("local service enquiries by call and form (synthetic scenario)", () => {
  const calls = basementCallRecords();
  beforeEach(async () => {
    await addAttributionBrand("project", "603 Basement Solutions");
    await addAttributionSourceRule(
      "project",
      {
        matchKind: "utm_source",
        pattern: "gbp",
        channel: "organic_search",
        sourceLabel: "Google Maps",
      },
      "user",
    );
    await load("calls", "tracker", calls);
    await ingestServerEvents("project", basementFormEvents());
    await load("crm", "job system", basementJobRecords());
  });

  it("counts calls as the source recorded them and labels 60-second calls a proxy", async () => {
    const report = await getCallsReport(query);
    const count = (status: string) =>
      calls.filter((c) => c.status === status).length;
    expect(report.totals).toMatchObject({
      calls: calls.length,
      answered: count("answered"),
      missed: count("missed"),
      voicemail: count("voicemail"),
      abandoned: count("abandoned"),
      conversationProxy: calls.filter(
        (c) => c.status === "answered" && c.duration_seconds >= 60,
      ).length,
      handoffFailed: calls.filter((c) => c.handoff === "failed").length,
    });
    expect(report.note).toContain("proxy");
    expect(report.bySource.map((s) => s.source)).toContain("Google Maps");
  });

  it("follows only the callers a tracker matched to a person, and invents no jobs or revenue", async () => {
    const report = await getCallsReport(query);
    expect(report.tiedToOutcomes.callers).toBe(12);
    expect(report.tiedToOutcomes.byStage).toEqual({
      enquiry: 5,
      qualified: 2,
      booked: 2,
      won: 3,
    });
    expect(report.tiedToOutcomes.contract).toEqual([
      { currency: "USD", minor: 2_850_000 },
    ]);
  });
});
