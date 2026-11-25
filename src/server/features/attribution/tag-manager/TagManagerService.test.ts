import { beforeEach, expect, it, vi } from "vitest";
import type * as Port from "./TagManagerPort";
import { TagManagerService } from "./TagManagerService";

const mock = vi.hoisted(() => ({
  entry: vi.fn(),
  approve: vi.fn(),
  begin: vi.fn(),
  live: vi.fn(),
  workspace: vi.fn(),
  trigger: vi.fn(),
  createTag: vi.fn(),
  tag: vi.fn(),
  executed: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ account: {} }));
vi.mock("@/server/lib/posthog", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/server/lib/background", () => ({ runAfterResponse: vi.fn() }));
vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: async () => "snippet-hash",
}));
vi.mock("@/server/features/google/googleOAuth", () => ({
  getGoogleAccessToken: async () => "token",
}));
vi.mock("@/server/features/google/GoogleAccountRepository", () => ({
  GoogleAccountRepository: {},
}));
vi.mock("@/server/features/ledger/services/LedgerService", () => ({
  LedgerService: {
    getEntry: mock.entry,
    approveChange: mock.approve,
    beginExecution: mock.begin,
    recordExecution: mock.executed,
  },
}));
vi.mock("../services/attributionSetup", () => ({
  getAttributionSetup: async () => ({
    properties: [{ host: "example.com" }],
    publicKey: "public",
    settings: { consentMode: "required" },
  }),
}));
vi.mock("./TagManagerPort", async (load) => ({
  ...(await load<typeof Port>()),
  tagManagerPort: () => ({
    live: mock.live,
    createWorkspace: mock.workspace,
    createPageTrigger: mock.trigger,
    createTag: mock.createTag,
    tag: mock.tag,
  }),
}));

const scope = { projectId: "project", organizationId: "org", userId: "user" };
const path = "accounts/123/containers/456";
const workspace = path + "/workspaces/2";
const entry = {
  id: "entry",
  provider: "google_tag_manager",
  organizationId: "org",
  status: "proposed",
  beforeState: "Live container version 1",
  afterState: JSON.stringify({
    containerPath: path,
    containerName: "Example",
    containerId: "GTM-EXAMPLE",
    accountId: "account",
    hostname: "example.com",
    snippetHash: "snippet-hash",
  }),
};

beforeEach(() => {
  mock.entry.mockResolvedValue({ entry });
  mock.live.mockResolvedValue({ containerVersionId: "1" });
});

it("refuses a changed container before approving or creating a workspace", async () => {
  mock.live.mockResolvedValueOnce({ containerVersionId: "2" });
  await expect(
    TagManagerService.stage(scope, "https://service.example", entry.id),
  ).rejects.toThrow("The published container version changed");
  expect(mock.approve).not.toHaveBeenCalled();
  expect(mock.workspace).not.toHaveBeenCalled();
});

it("approves before writing and records a draft only after reading the same tag back", async () => {
  mock.workspace.mockResolvedValueOnce({ path: workspace });
  mock.trigger.mockResolvedValueOnce({ triggerId: "9" });
  mock.createTag.mockImplementationOnce(
    (_workspace: string, name: string, triggerId: string, html: string) => {
      const tag = {
        tagId: "7",
        type: "html",
        name,
        firingTriggerId: [triggerId],
        parameter: [{ key: "html", value: html }],
      };
      mock.tag.mockResolvedValueOnce(tag);
      return tag;
    },
  );
  mock.executed.mockResolvedValueOnce({
    ...entry,
    status: "executed",
    publicationStatus: "draft",
  });

  const result = await TagManagerService.stage(
    scope,
    "https://service.example",
    entry.id,
  );
  expect(result.publication).toBe("draft");
  expect(mock.approve.mock.invocationCallOrder[0]).toBeLessThan(
    mock.workspace.mock.invocationCallOrder[0],
  );
  expect(mock.tag.mock.invocationCallOrder[0]).toBeLessThan(
    mock.executed.mock.invocationCallOrder[0],
  );
});
