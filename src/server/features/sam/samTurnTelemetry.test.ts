import { describe, expect, it, vi } from "vitest";
import type { StepContext, ToolCallResultContext } from "@cloudflare/think";
import { SamTurnStats } from "@/server/features/sam/samTurnTelemetry";

vi.mock("@/server/lib/posthog", () => ({
  captureServerEvent: vi.fn(),
  captureServerError: vi.fn(),
}));

const step = (overrides: Record<string, unknown> = {}) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields recordStep reads
  ({
    response: { modelId: "openai/gpt-5.6-luna" },
    usage: {
      inputTokens: 1000,
      outputTokens: 200,
      inputTokenDetails: { cacheReadTokens: 400 },
      outputTokenDetails: { reasoningTokens: 150 },
    },
    toolCalls: [{ toolName: "research_keywords" }],
    finishReason: "tool-calls",
    ...overrides,
  }) as unknown as StepContext;

const toolCall = (overrides: Record<string, unknown> = {}) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields recordToolCall reads
  ({
    toolName: "research_keywords",
    success: true,
    output: { summary: "ok" },
    toolExecutionMs: 120,
    ...overrides,
  }) as unknown as ToolCallResultContext;

describe("SamTurnStats", () => {
  it("sums steps and tool calls into the turn event, counting {error} outputs as failures", () => {
    const stats = new SamTurnStats();
    // Each generation is linked to the turn as its trace.
    expect(stats.recordStep(step(), 0.01)).toMatchObject({
      $ai_trace_id: stats.turnId,
      $ai_parent_id: stats.turnId,
      $ai_model: "openai/gpt-5.6-luna",
    });
    stats.recordStep(step({ toolCalls: [], finishReason: "stop" }), 0.02);
    stats.recordSpend(0.03);
    stats.recordToolCall(toolCall());
    stats.recordToolCall(
      toolCall({ toolName: "read_pages", output: { error: "blocked" } }),
    );
    stats.recordToolCall(toolCall({ success: false, error: new Error("x") }));

    expect(stats.properties("completed")).toMatchObject({
      turn_id: stats.turnId,
      status: "completed",
      model: "openai/gpt-5.6-luna",
      steps: 2,
      input_tokens: 2000,
      output_tokens: 400,
      reasoning_tokens: 300,
      cached_input_tokens: 800,
      cost_usd: 0.03,
      tool_calls: 3,
      tool_failures: 2,
      tools: ["research_keywords", "read_pages"],
      tool_ms: 360,
    });
    expect(stats.traceProperties("error", "boom")).toMatchObject({
      $ai_trace_id: stats.turnId,
      $ai_is_error: true,
      $ai_error: "boom",
    });
  });
});
