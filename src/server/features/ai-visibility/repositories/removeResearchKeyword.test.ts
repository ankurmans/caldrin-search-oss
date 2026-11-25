import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projects } from "@/db/schema";
import { removeResearchKeyword } from "./aiVisibilityConfigurationRepository";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));

const read = async (id: string) =>
  (
    await testDb.db
      .select({ keywords: projects.aiResearchKeywords })
      .from(projects)
      .where(eq(projects.id, id))
  )[0]?.keywords;

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.client.execute(
    "INSERT INTO projects (id, organization_id, name, domain, ai_research_keywords) VALUES ('other', 'organization', 'Other', 'other.com', 'rank tracker\nbacklinks')",
  );
  await testDb.db
    .update(projects)
    .set({ aiResearchKeywords: "Rank Tracker\nbacklinks\nseo tool" })
    .where(eq(projects.id, "project"));
});

describe("removeResearchKeyword", () => {
  it("removes one keyword ignoring case and spacing, and leaves other projects alone", async () => {
    expect(await removeResearchKeyword("project", "  rank   tracker ")).toBe(
      true,
    );
    expect(await read("project")).toBe("backlinks\nseo tool");
    expect(await read("other")).toBe("rank tracker\nbacklinks");
  });

  it("leaves an empty list, not null, so setup never refills it", async () => {
    for (const keyword of ["rank tracker", "backlinks", "seo tool"])
      await removeResearchKeyword("project", keyword);
    expect(await read("project")).toBe("");
  });

  it("reports false when the keyword is gone or setup never ran", async () => {
    expect(await removeResearchKeyword("project", "missing")).toBe(false);
    await testDb.db
      .update(projects)
      .set({ aiResearchKeywords: null })
      .where(eq(projects.id, "project"));
    expect(await removeResearchKeyword("project", "backlinks")).toBe(false);
    expect(await read("project")).toBeNull();
  });
});
