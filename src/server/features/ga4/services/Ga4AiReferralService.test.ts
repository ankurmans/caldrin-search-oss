import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ga4AiReferralService } from "./Ga4AiReferralService";

const runReport = vi.hoisted(() => vi.fn());
vi.mock("./Ga4ReportingService", () => ({
  Ga4ReportingService: { runReport },
}));

const report = (rows: Record<string, string | number>[]) => ({
  rows,
  warnings: [],
  request: {
    resolvedDateRange: { startDate: "2026-10-20", endDate: "2026-11-16" },
  },
});

beforeEach(() => {
  runReport.mockImplementation(
    (input: { kind: string; includeDate?: boolean }) =>
      Promise.resolve(
        input.includeDate
          ? report([
              {
                sessionSourceMedium: "chatgpt.com / referral",
                date: "20261116",
                sessions: 6,
              },
              {
                sessionSourceMedium: "perplexity / referral",
                date: "20261110",
                sessions: 1,
              },
              {
                sessionSourceMedium: "chatgpt.com / referral",
                date: "20261101",
                sessions: 3,
              },
            ])
          : input.kind === "landing_pages"
            ? report([
                {
                  hostName: "a.com",
                  landingPage: "/x",
                  sessions: 4,
                  keyEvents: 1,
                },
              ])
            : report([
                { sessionSourceMedium: "chatgpt.com / referral", sessions: 5 },
                {
                  sessionSourceMedium: "chat.openai.com / referral",
                  sessions: 3,
                },
                { sessionSourceMedium: "perplexity / referral", sessions: 2 },
              ]),
      ),
  );
});

describe("getAiReferrals", () => {
  it("adds up the spellings of one assistant and ranks assistants by sessions", async () => {
    const result = await Ga4AiReferralService.getAiReferrals("p1");

    expect(result.assistants.map((a) => [a.name, a.sessions])).toEqual([
      ["ChatGPT", 8],
      ["Perplexity", 2],
    ]);
    expect(result.totalSessions).toBe(10);
    expect(result.weeks.map((w) => [w.end, w.sessions])).toEqual([
      ["2026-10-26", 0],
      ["2026-11-02", 3],
      ["2026-11-09", 0],
      ["2026-11-16", 7],
    ]);
    expect(result.pages).toEqual([
      { host: "a.com", path: "/x", sessions: 4, keyEvents: 1 },
    ]);
  });
});
