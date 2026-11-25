import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRestApiRequest } from "./restApi";

const { getResults, getTrackerConfigs, authenticate, allowedProjects } =
  vi.hoisted(() => ({
    getResults: vi.fn(),
    getTrackerConfigs: vi.fn(),
    authenticate: vi.fn(),
    allowedProjects: vi.fn(),
  }));

vi.mock("@/server/mcp/api-key-auth", () => ({
  authenticateApiKeyRequest: authenticate,
}));
vi.mock("@/server/auth/project-access", () => ({
  getAllowedProjectIds: allowedProjects,
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: vi.fn(async (_org: string, id: string) =>
      id === PROJECT ? { id } : null,
    ),
    listProjects: vi.fn(async () => [
      {
        id: PROJECT,
        name: "Demo",
        domain: "demo.example",
        locationCode: 2840,
        languageCode: "en",
      },
    ]),
  },
}));
vi.mock("@/server/features/ai-visibility/services/AiVisibilityService", () => ({
  AiVisibilityService: { getResults },
}));
vi.mock("@/server/features/rank-tracking/services/RankTrackingService", () => ({
  RankTrackingService: { getConfigs: getTrackerConfigs },
}));

const PROJECT = "11111111-1111-4111-8111-111111111111";
const call = (path: string, init?: RequestInit) =>
  handleRestApiRequest(
    new Request(`https://search.example/api/v1${path}`, init),
    {},
  );

beforeEach(() => {
  authenticate.mockResolvedValue({
    auth: { userId: "u", organizationId: "o", role: "owner" },
  });
  allowedProjects.mockResolvedValue(null);
  getResults.mockResolvedValue({ rows: [] });
  getTrackerConfigs.mockResolvedValue([]);
});

describe("REST API", () => {
  it("returns the key's error response without calling a service", async () => {
    authenticate.mockResolvedValue({
      response: new Response("no", { status: 401 }),
    });

    const response = await call(`/projects/${PROJECT}/ai-visibility/results`);

    expect(response.status).toBe(401);
    expect(getResults).not.toHaveBeenCalled();
  });

  it("answers 404 for a project outside the key's access, same as a missing one", async () => {
    allowedProjects.mockResolvedValue([]);

    const response = await call(`/projects/${PROJECT}/ai-visibility/results`);

    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
    expect(getResults).not.toHaveBeenCalled();
  });

  it("passes query filters to the service in the shape its schema expects", async () => {
    await call(
      `/projects/${PROJECT}/ai-visibility/results?engines=chatgpt,perplexity&limit=5`,
    );

    expect(getResults).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        engines: ["chatgpt", "perplexity"],
        limit: 5,
      }),
    );
  });

  it("rejects an invalid filter with 400 and never writes", async () => {
    const response = await call(
      `/projects/${PROJECT}/ai-visibility/results?engines=altavista`,
    );
    expect(response.status).toBe(400);

    const post = await call(`/projects/${PROJECT}/rank-trackers`, {
      method: "POST",
    });
    expect(post.status).toBe(405);
  });
});
