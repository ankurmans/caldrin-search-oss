import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCrawlerActivity } from "./aiCrawlerActivity";
import { recordCrawlerHit, recordCrawlerLog } from "./aiCrawlerIngest";
import { rotateCrawlerKey } from "./aiCrawlerKeys";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../../ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));

const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2)";
const BROWSER = "Mozilla/5.0 (Macintosh) Chrome/130.0 Safari/537.36";

describe("AI crawler visits", () => {
  beforeEach(async () => {
    await testDb.seedProject();
  });

  it("counts claimed AI crawler visits by bot and path, and drops everything else", async () => {
    const { key } = await rotateCrawlerKey("project");
    const visit = (userAgent: string, path: string, status = 200) =>
      recordCrawlerHit(key, { userAgent, path, status });

    await visit(GPTBOT, "/pricing?utm_source=x");
    await visit(GPTBOT, "/pricing", 404);
    await visit(BROWSER, "/pricing");

    expect(
      await recordCrawlerHit("cldr_bot_wrong", {
        userAgent: GPTBOT,
        path: "/",
        status: 200,
      }),
    ).toBeNull();
    const activity = await getCrawlerActivity(
      {
        projectId: "project",
        days: 7,
      },
      "caldrin.co",
    );
    expect(activity.totalHits).toBe(2);
    expect(activity.bots).toMatchObject([
      { token: "GPTBot", hits: 2, errorHits: 1 },
    ]);
    expect(activity.topPaths).toEqual([{ path: "/pricing", hits: 2 }]);
    expect(activity.pathDiagnostics).toMatchObject([
      { path: "/pricing", visits: 2, errors: 1 },
    ]);
  });

  it("stops accepting the old key once a new one is created", async () => {
    const { key: old } = await rotateCrawlerKey("project");
    await rotateCrawlerKey("project");

    expect(
      await recordCrawlerHit(old, {
        userAgent: GPTBOT,
        path: "/",
        status: 200,
      }),
    ).toBeNull();
  });

  it("counts a pasted access log and a log-drain batch on the days they give", async () => {
    const { key } = await rotateCrawlerKey("project");
    const day = new Date().toISOString().slice(0, 10);
    const [year, month, date] = day.split("-");
    const stamp = `${date}/${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1]}/${year}:12:00:00 +0000`;
    const combined = (ua: string, path: string, status: number) =>
      `203.0.113.9 - - [${stamp}] "GET ${path} HTTP/1.1" ${status} 512 "-" "${ua}"`;
    const drain = JSON.stringify({
      timestamp: Date.now(),
      proxy: { path: "/blog", statusCode: 200, userAgent: [GPTBOT] },
    });

    const result = await recordCrawlerLog(
      key,
      [
        combined(GPTBOT, "/pricing?x=1", 200),
        combined(GPTBOT, "/pricing", 500),
        combined(BROWSER, "/pricing", 200),
        "not a log line",
        drain,
      ].join("\n"),
    );

    expect(result).toEqual({ lines: 5, skipped: 1, counted: 3 });
    const activity = await getCrawlerActivity({
      projectId: "project",
      days: 7,
    });
    expect(activity.bots).toMatchObject([
      { token: "GPTBot", hits: 3, errorHits: 1 },
    ]);
    expect(activity.topPaths[0]).toEqual({ path: "/pricing", hits: 2 });
  });
});
