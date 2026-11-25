import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { buildBrief } from "../rules/briefBuilder";
import { createSimulatedShop } from "../shopify/simulatedShop";
import { generateLlmDraft } from "./llmDraft";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));

vi.mock("ai", () => ({
  generateText,
  Output: { object: (value: unknown) => value },
}));
vi.mock("@/server/lib/llmCost", () => ({ llmCostUsd: () => 0 }));
vi.mock("@/server/lib/openrouter", () => ({
  buildChatAgentModel: vi.fn(),
  requireOpenRouterAccess: async () => ({ apiKey: "key" }),
}));

function section(key: "writing_preferences" | "current_goal", content: string) {
  return { key, content, updatedAt: "2026-11-19", updatedBy: "user" as const };
}

describe("AI draft prompt", () => {
  it("includes the saved brand notes and merchant facts but not the current goal", async () => {
    generateText.mockResolvedValue({
      output: {
        title: "t",
        bodyHtml: "<p>b</p>",
        metaTitle: "m",
        metaDescription: "d",
      },
    });
    const store = await createSimulatedShop("brand-notes.test").readSnapshot();
    const brief = buildBrief(
      {
        query: "ride on toys",
        pageUrl: "",
        clicks: 1,
        impressions: 10,
        ctr: 0.1,
        position: 8,
        action: "new_article",
        reason: "r",
        matchedCollectionHandle: null,
      },
      store,
    );

    await generateLlmDraft(brief, store, {
      brandName: "Tough Trucks",
      sections: [
        section("writing_preferences", "Plain and direct. Never say seamless."),
        section("current_goal", "Double signups by Q4."),
      ],
      customSections: [
        {
          slug: "merchant-facts",
          title: "Merchant facts",
          content: "- Mongoose ATV Quad age: 8 and up",
          updatedAt: "2026-11-19",
          updatedBy: "user",
        },
      ],
    });

    const { prompt } = z
      .object({ prompt: z.string() })
      .parse(generateText.mock.calls[0]?.[0]);
    expect(prompt).toContain("Brand name: Tough Trucks");
    expect(prompt).toContain("Never say seamless");
    expect(prompt).not.toContain("Double signups");
    expect(prompt).toContain("Mongoose ATV Quad age: 8 and up");
  });
});
