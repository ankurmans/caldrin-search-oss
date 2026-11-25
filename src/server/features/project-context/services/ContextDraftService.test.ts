import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  ContextDraftRefusal,
  ContextDraftService,
} from "./ContextDraftService";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const { generateText, getProject } = vi.hoisted(() => ({
  generateText: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText,
  Output: { object: (value: unknown) => value },
}));
vi.mock("@/server/lib/llmCost", () => ({ llmCostUsd: () => 0 }));
vi.mock("@/server/lib/openrouter", () => ({
  buildChatAgentModel: vi.fn(),
  requireOpenRouterAccess: async () => ({ apiKey: "key" }),
}));
vi.mock("@/server/lib/scrape", () => ({
  readSite: async () => ({
    pages: [
      { url: "https://shop.test", title: "Shop", text: "We sell swings." },
    ],
    blocked: false,
  }),
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: { getProjectForOrganization: getProject },
}));
vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({
    ProjectContextRepository: {
      listSections: async () => [],
      listCompetitors: async () => [],
    },
  }),
);
vi.mock("@/server/features/spend/services/SpendService", () => ({
  SpendService: {
    estimateLlmDraftUsd: () => ({ estimatedUsd: 0.05 }),
    assertWithinLimits: vi.fn(),
    recordCost: vi.fn(),
  },
}));

const scope = { projectId: "p", organizationId: "o", userId: "u" };

describe("context draft", () => {
  it("drafts only fields it has evidence for, and never a goal without the owner's notes", async () => {
    getProject.mockResolvedValue({
      name: "Shop",
      brandName: null,
      domain: "shop.test",
    });
    generateText.mockResolvedValue({
      output: {
        business_overview: "Rope swings for gardens.",
        positioning: "",
      },
    });

    const result = await ContextDraftService.draft(scope, {
      fields: ["business_overview", "current_goal", "positioning"],
    });

    const asked = z
      .object({
        output: z.object({
          schema: z.object({ shape: z.record(z.string(), z.unknown()) }),
        }),
      })
      .parse(generateText.mock.calls[0]?.[0]);
    expect(Object.keys(asked.output.schema.shape)).toEqual([
      "business_overview",
      "positioning",
    ]);
    expect(result.drafts).toEqual([
      { section: "business_overview", content: "Rope swings for gardens." },
    ]);
  });

  it("refuses a project with no website before spending anything", async () => {
    getProject.mockResolvedValue({
      name: "Shop",
      brandName: null,
      domain: null,
    });

    await expect(
      ContextDraftService.draft(scope, { fields: ["business_overview"] }),
    ).rejects.toBeInstanceOf(ContextDraftRefusal);
    expect(generateText).not.toHaveBeenCalled();
  });
});
