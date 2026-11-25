import { expect, test, vi } from "vitest";
import { readCodingAgentPanel } from "./codingAgentService";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

const { latestPanel } = vi.hoisted(() => ({
  latestPanel: vi.fn().mockResolvedValue(null),
}));
vi.mock("./codingAgentRepository", () => ({
  codingAgentRepository: { latestPanel },
}));
vi.mock("@/server/lib/runtime-env", () => ({ getOptionalEnvValue: vi.fn() }));

test("opens only the explicitly granted staff and project pair", async () => {
  vi.mocked(getOptionalEnvValue).mockResolvedValue(
    "project-a:staff-a,project-b:staff-b",
  );
  await expect(
    readCodingAgentPanel({
      projectId: "project-a",
      userId: "staff-a",
      role: "owner",
    }),
  ).resolves.toBeNull();
  expect(latestPanel).toHaveBeenCalledExactlyOnceWith("project-a");
  await expect(
    readCodingAgentPanel({
      projectId: "project-b",
      userId: "staff-a",
      role: "owner",
    }),
  ).resolves.toBe(false);
  await expect(
    readCodingAgentPanel({
      projectId: "project-b",
      userId: "staff-b",
      role: "admin,scoped",
    }),
  ).resolves.toBe(false);
  expect(latestPanel).toHaveBeenCalledTimes(1);
});
