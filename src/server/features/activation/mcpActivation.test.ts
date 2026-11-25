import { expect, it, vi } from "vitest";
import { ActivationRepository } from "@/server/features/activation/repositories/ActivationRepository";
import { recordExternalMcpToolCall } from "./mcpActivation";

vi.mock("cloudflare:workers", () => ({ waitUntil: vi.fn() }));
vi.mock("@/server/lib/posthog", () => ({ captureServerEvent: vi.fn() }));
vi.mock(
  "@/server/features/activation/repositories/ActivationRepository",
  () => ({
    ActivationRepository: {
      recordFirstMcpToolCall: vi.fn(),
    },
  }),
);

it("records an organization's first tool call once per isolate", async () => {
  await recordExternalMcpToolCall({ organizationId: "org-1" });
  await recordExternalMcpToolCall({ organizationId: "org-1" });

  expect(
    ActivationRepository.recordFirstMcpToolCall,
  ).toHaveBeenCalledExactlyOnceWith("org-1");
});
