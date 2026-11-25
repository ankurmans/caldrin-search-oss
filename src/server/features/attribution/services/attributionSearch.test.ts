import { beforeEach, describe, expect, it, vi } from "vitest";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import { GscService } from "@/server/features/gsc/services/GscService";
import { Ga4AiReferralService } from "@/server/features/ga4/services/Ga4AiReferralService";
import { SourceIntelligenceRepository } from "@/server/features/source-intelligence/repositories/SourceIntelligenceRepository";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import type { LedgerEntry } from "@/server/features/ledger/types";
import { ingestServerEvents } from "./attributionApiIngest";
import { ingestNormalized } from "./attributionIngest";
import { getAiReferralIntelligence } from "./attributionAiReferrals";
import { getChangeMovement } from "./attributionChangeMovement";
import {
  createAttributionOpportunity,
  getAttributionFindings,
} from "./attributionFindings";
import { getKeywordAssociations } from "./attributionKeywords";
import { getLandingPages } from "./attributionLanding";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../../ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: vi.fn() },
}));
vi.mock("@/server/features/ga4/services/Ga4AiReferralService", () => ({
  Ga4AiReferralService: { getAiReferrals: vi.fn() },
}));
vi.mock(
  "@/server/features/source-intelligence/repositories/SourceIntelligenceRepository",
  () => ({ SourceIntelligenceRepository: { citedCounts: vi.fn() } }),
);
vi.mock("@/server/features/ledger/services/LedgerService", () => ({
  LedgerService: { listEntries: vi.fn() },
}));

const DAY = 86_400_000;
const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * DAY).toISOString();
const query = { projectId: "project", range: "28d", demo: false } as const;
const gscRow = (keys: string[], clicks: number, position: number) => ({
  keys,
  clicks,
  impressions: clicks * 20,
  ctr: 0.05,
  position,
});

const cited = (key: string, engine: string, answers: number) => ({
  key,
  engine,
  answers,
  domain: "example.com",
  title: null,
  description: null,
  lastSeen: null,
});

const ledgerEntry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: "entry-1",
  projectId: "project",
  organizationId: "organization",
  opportunityId: null,
  kind: "content_article_update",
  provider: "manual",
  status: "executed",
  publicationStatus: "published",
  targetUrl: null,
  contentAssetId: null,
  contentRevision: null,
  externalId: null,
  proposedAction: "Rewrite the pricing page intro",
  beforeState: null,
  afterState: null,
  diff: null,
  requestedByUserId: "user",
  approvedByUserId: null,
  approvedAt: null,
  approvedRevision: null,
  executedByUserId: null,
  executedAt: null,
  error: null,
  rollbackKind: "none",
  rollbackPayload: null,
  rolledBackAt: null,
  rolledBackByUserId: null,
  measurementMetric: null,
  measurementWindowDays: null,
  baselineStart: null,
  baselineEnd: null,
  finalDecision: null,
  finalDecidedByUserId: null,
  finalDecidedAt: null,
  idempotencyKey: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

type Session = {
  id: string;
  visitor: string;
  path: string;
  referrer: string;
  daysAgo: number;
};
const session = (s: Session) => ({
  sourceSystem: "tracker",
  sourceEventId: s.id,
  origin: "browser" as const,
  eventType: "session_start" as const,
  occurredAt: iso(s.daysAgo),
  identifiers: [{ type: "visitor" as const, value: s.visitor }],
  referrerHost: s.referrer,
  landingHost: "example.com",
  landingPath: s.path,
});

/** One search buyer, one buyer an assistant sent, and many visitors to a page that never converts. */
async function seed() {
  await ingestNormalized(
    "project",
    { sourceSystem: "tracker", label: "Tracker snippet" },
    [
      session({
        id: "s1",
        visitor: "v1",
        path: "/pricing",
        referrer: "google.com",
        daysAgo: 6,
      }),
      session({
        id: "s2",
        visitor: "v2",
        path: "/guide",
        referrer: "chatgpt.com",
        daysAgo: 5,
      }),
      ...Array.from({ length: 35 }, (_, i) =>
        session({
          id: `b${i}`,
          visitor: `bv${i}`,
          path: "/blog/long",
          referrer: "google.com",
          daysAgo: 4,
        }),
      ),
    ],
  );
  await ingestServerEvents("project", [
    {
      event_id: "su1",
      type: "signup",
      visitor_id: "v1",
      user_id: "u1",
      occurred_at: iso(5),
    },
    {
      event_id: "p1",
      type: "payment",
      user_id: "u1",
      amount_minor: 4900,
      currency: "USD",
      occurred_at: iso(4),
    },
    {
      event_id: "su2",
      type: "signup",
      visitor_id: "v2",
      user_id: "u2",
      occurred_at: iso(4),
    },
    {
      event_id: "p2",
      type: "payment",
      user_id: "u2",
      amount_minor: 2000,
      currency: "USD",
      occurred_at: iso(3),
    },
    {
      event_id: "p3",
      type: "payment",
      customer_id: "c3",
      amount_minor: 1000,
      currency: "USD",
      self_reported_source: "ChatGPT",
      occurred_at: iso(3),
    },
  ]);
}

beforeEach(async () => {
  await testDb.seedProject();
  await seed();
  vi.mocked(GscService.getPerformance).mockImplementation(async (input) => {
    const rows = input.dimensions?.includes("query")
      ? [
          gscRow(["https://example.com/pricing", "buy widgets"], 90, 3),
          gscRow(["https://example.com/pricing", "widget pricing"], 30, 6),
          gscRow(["https://example.com/other", "unrelated"], 500, 2),
        ]
      : [
          gscRow(["https://example.com/pricing"], 120, 4.2),
          gscRow(["https://example.com/blog/long"], 60, 8),
        ];
    return {
      siteUrl: "https://example.com/",
      connectedBy: null,
      request: { startDate: "2026-01-01", endDate: "2026-01-28" },
      rows,
    };
  });
  vi.mocked(Ga4AiReferralService.getAiReferrals).mockResolvedValue({
    dateRange: { startDate: "2026-01-01", endDate: "2026-01-28" },
    weeks: [],
    totalSessions: 4,
    assistants: [
      { name: "ChatGPT", sessions: 4, engagedSessions: 2, keyEvents: 1 },
    ],
    pages: [],
    warnings: [],
  });
  vi.mocked(SourceIntelligenceRepository.citedCounts).mockResolvedValue([
    cited("https://example.com/guide", "chatgpt", 5),
    cited("https://example.com/cited-only", "perplexity", 4),
  ]);
  vi.mocked(LedgerService.listEntries).mockResolvedValue([]);
});

describe("landing page outcomes", () => {
  it("credits outcomes to the page the buyer first landed on and puts Search Console beside them as a separate reading", async () => {
    const { pages, searchStatus } = await getLandingPages(query);

    const pricing = pages.find((p) => p.path === "/pricing");
    expect(searchStatus).toBe("ok");
    expect(pricing?.revenue).toEqual([{ currency: "USD", minor: 4900 }]);
    expect(pricing?.commercial).toBe(true);
    expect(pricing?.search).toMatchObject({ clicks: 120, position: 4.2 });
    expect(pages.find((p) => p.path === "/blog/long")).toMatchObject({
      sessions: 35,
      commercial: false,
    });
  });

  it("still shows first-party pages, with no search figures, when Search Console is not connected", async () => {
    vi.mocked(GscService.getPerformance).mockRejectedValue(
      new GscNotConnectedError("project"),
    );

    const { pages, searchStatus } = await getLandingPages(query);

    expect(searchStatus).toBe("not_connected");
    expect(pages.find((p) => p.path === "/pricing")?.search).toBeNull();
  });
});

describe("keyword-associated outcomes", () => {
  it("divides a page's organic outcomes by each query's share of clicks and labels them Associated", async () => {
    const result = await getKeywordAssociations({
      ...query,
      host: "example.com",
      path: "/pricing",
    });

    expect(result.evidence).toBe("associated");
    // Only this page's queries: the other page's 500 clicks are not mixed in.
    expect(result.queries.map((q) => q.query)).toEqual([
      "buy widgets",
      "widget pricing",
    ]);
    expect(result.queries[0]?.revenue).toEqual([
      { currency: "USD", minor: 3675 },
    ]);
    expect(result.queries[1]?.revenue).toEqual([
      { currency: "USD", minor: 1225 },
    ]);
  });
});

describe("AI referral intelligence", () => {
  it("counts a visit as AI-referred only when a referrer says so, keeps buyers' own words apart, and lists cited pages with no visits", async () => {
    const result = await getAiReferralIntelligence(query);

    const chatgpt = result.assistants.find((a) => a.name === "ChatGPT");
    expect(chatgpt?.sessions).toBe(1);
    expect(chatgpt?.selfReported).toBe(1);
    expect(chatgpt?.revenue).toEqual([{ currency: "USD", minor: 2000 }]);
    expect(result.pages.find((p) => p.path === "/guide")).toMatchObject({
      sessions: 1,
      citedAnswers: 5,
    });
    expect(result.citedWithoutVisits.map((p) => p.path)).toEqual([
      "/cited-only",
    ]);
    // GA4's four sessions are a cross-check next to the one first-party session, never added to it.
    expect(result.ga4.assistants[0]).toMatchObject({
      sessions: 4,
      firstPartySessions: 1,
    });
  });
});

describe("opportunities from findings", () => {
  it("stores a finding once as a Search Opportunity, however many times it is created", async () => {
    const { findings } = await getAttributionFindings(query);
    const finding = findings.find((f) => f.path === "/blog/long");
    expect(finding?.rule).toBe("search_traffic_no_outcome");

    const scope = { projectId: "project", organizationId: "organization" };
    const first = await createAttributionOpportunity(
      scope,
      query,
      finding?.key ?? "",
    );
    const second = await createAttributionOpportunity(
      scope,
      query,
      finding?.key ?? "",
    );

    expect(second.opportunityId).toBe(first.opportunityId);
  });
});

describe("opportunities from demo data", () => {
  it("refuses to turn invented demo pages into a real project's opportunities", async () => {
    const scope = { projectId: "project", organizationId: "organization" };

    await expect(
      createAttributionOpportunity(scope, { ...query, demo: true }, "any"),
    ).rejects.toThrow("Demo data cannot be saved");
  });
});

describe("change ledger movement", () => {
  it("reads before and after a published change as observed movement, never as an effect", async () => {
    vi.mocked(LedgerService.listEntries).mockResolvedValue([
      ledgerEntry({
        executedAt: iso(5.5),
        targetUrl: "https://www.example.com/pricing/",
        measurementWindowDays: 7,
      }),
    ]);

    const result = await getChangeMovement({
      ...query,
      host: "example.com",
      path: "/pricing",
    });

    const [change] = result.changes;
    expect(result.label).toBe("Observed movement");
    expect(result.note).toContain("does not show that the change caused");
    expect(change?.afterComplete).toBe(false);
    // The visit was before the change; the signup and the payment came after it.
    expect(change?.before).toMatchObject({ sessions: 1, outcomes: 0 });
    expect(change?.after).toMatchObject({
      sessions: 0,
      outcomes: 2,
      revenue: [{ currency: "USD", minor: 4900 }],
    });
  });
});
