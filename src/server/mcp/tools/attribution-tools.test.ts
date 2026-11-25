import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestServerEvents } from "@/server/features/attribution/services/attributionApiIngest";
import {
  getAttributionEvidenceTool,
  getAttributionLeadsTool,
  getAttributionOverviewTool,
} from "./attribution-tools";
import { makeToolContext, textContent } from "./tool-test-support";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/mcp/project-auth", () => ({
  withMcpProjectAuth:
    <A extends { projectId: string }, R>(
      handler: (args: A, context: unknown) => R,
    ) =>
    (args: A) =>
      handler(args, {
        auth: makeToolContext().auth,
        baseUrl: "https://caldrin-search.test",
      }),
}));

const args = { projectId: "project", range: "28d" } as const;

beforeEach(async () => {
  await testDb.seedProject();
  await ingestServerEvents("project", [
    {
      event_id: "p1",
      type: "payment",
      customer_id: "c1",
      amount_minor: 4900,
      currency: "USD",
      occurred_at: new Date().toISOString(),
    },
  ]);
});

describe("attribution MCP tools", () => {
  it("reports an unattributed payment as Unknown instead of crediting a channel", async () => {
    const result = await getAttributionOverviewTool.handler(
      args,
      makeToolContext(),
    );

    expect(JSON.stringify(result.structuredContent)).toContain("unknown");
  });

  it("refuses a brand the project does not have and lists the ones it does", async () => {
    const result = (await getAttributionLeadsTool.handler(
      {
        ...args,
        view: "pipeline",
        brand: "Nope",
      },
      makeToolContext(),
    )) as { content: Array<{ type: string; text?: string }> };

    expect(textContent(result)).toContain('No brand named "Nope"');
  });

  it("refuses an outcome id from another project", async () => {
    const result = await getAttributionEvidenceTool.handler(
      {
        projectId: "project",
        conversionId: "missing",
      },
      makeToolContext(),
    );

    expect(result.structuredContent).toMatchObject({ refused: true });
  });
});
