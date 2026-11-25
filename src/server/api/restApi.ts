import { z } from "zod";
import { canAccessProject } from "@/lib/org-permissions";
import { getAllowedProjectIds } from "@/server/auth/project-access";
import { AiVisibilityService } from "@/server/features/ai-visibility/services/AiVisibilityService";
import { ProjectService } from "@/server/features/projects/services/ProjectService";
import { RankTrackingService } from "@/server/features/rank-tracking/services/RankTrackingService";
import { authenticateApiKeyRequest } from "@/server/mcp/api-key-auth";
import { asAppError, describeError } from "@/server/lib/errors";
import {
  aiAnswerSchema,
  aiMetricRowsSchema,
  aiResultsSchema,
  aiSourcesSchema,
  aiTrendSchema,
} from "@/types/schemas/ai-visibility";
import { aiIntelligenceSchema } from "@/types/schemas/ai-visibility-intelligence";

// Read-only JSON API over the same services the app and MCP use, authenticated
// with the workspace's API keys. It never starts a paid collection.

export const REST_API_PREFIX = "/api/v1";

type Auth = { userId: string; organizationId: string; role: string };
type Query = Record<string, unknown>;
type Route = {
  pattern: RegExp;
  describe: string;
  /** The handler returns CSV text, sent as a file instead of JSON. */
  csv?: boolean;
  handle: (
    match: string[],
    query: Query,
    projectId: string,
  ) => Promise<unknown>;
};

/** `?engines=chatgpt,perplexity&limit=20` as the schemas expect it. */
function parseQuery(params: URLSearchParams): Query {
  const query: Query = {};
  for (const [key, value] of params) {
    if (key === "engines") query[key] = value ? value.split(",") : [];
    else if (/^\d+$/.test(value)) query[key] = Number(value);
    else if (value === "true" || value === "false")
      query[key] = value === "true";
    else query[key] = value;
  }
  return query;
}

const PROJECT = "^/projects/([^/]+)";
const routes: Route[] = [
  {
    pattern: new RegExp(`${PROJECT}/ai-visibility/tracker$`),
    describe: "GET /projects/{projectId}/ai-visibility/tracker",
    handle: (_m, _q, projectId) =>
      AiVisibilityService.getTracker({ projectId }),
  },
  {
    pattern: new RegExp(`${PROJECT}/ai-visibility/runs/([^/]+)$`),
    describe: "GET /projects/{projectId}/ai-visibility/runs/{runId}",
    handle: (m, _q, projectId) =>
      AiVisibilityService.getRun({ projectId, runId: m[2] }),
  },
  {
    pattern: new RegExp(`${PROJECT}/ai-visibility/results$`),
    describe:
      "GET /projects/{projectId}/ai-visibility/results?runId&topic&engines&promptId&limit&cursor",
    handle: (_m, q, projectId) =>
      AiVisibilityService.getResults(
        aiResultsSchema.parse({ ...q, projectId }),
      ),
  },
  {
    pattern: new RegExp(`${PROJECT}/ai-visibility/sources$`),
    describe:
      "GET /projects/{projectId}/ai-visibility/sources?runId&groupBy&ownership&engines&limit&cursor",
    handle: (_m, q, projectId) =>
      AiVisibilityService.getSources(
        aiSourcesSchema.parse({ ...q, projectId }),
      ),
  },
  {
    pattern: new RegExp(`${PROJECT}/ai-visibility/answers/([^/]+)$`),
    describe: "GET /projects/{projectId}/ai-visibility/answers/{observationId}",
    handle: (m, _q, projectId) =>
      AiVisibilityService.getAnswer(
        aiAnswerSchema.parse({ projectId, observationId: m[2] }),
      ),
  },
  {
    pattern: new RegExp(`${PROJECT}/ai-visibility/insights$`),
    describe:
      "GET /projects/{projectId}/ai-visibility/insights?days&engines&topic&branded",
    handle: (_m, q, projectId) =>
      AiVisibilityService.getIntelligence(
        aiIntelligenceSchema.parse({ ...q, projectId }),
      ),
  },
  {
    pattern: new RegExp(`${PROJECT}/ai-visibility/trend$`),
    describe: "GET /projects/{projectId}/ai-visibility/trend?days",
    handle: (_m, q, projectId) =>
      AiVisibilityService.getTrend(aiTrendSchema.parse({ ...q, projectId })),
  },
  {
    pattern: new RegExp(`${PROJECT}/ai-visibility/metrics\\.csv$`),
    describe:
      "GET /projects/{projectId}/ai-visibility/metrics.csv?days&locationCode&languageCode (one row per collected answer, no answer text, for spreadsheets and BI tools)",
    csv: true,
    handle: async (_m, q, projectId) => {
      const { loadAiMetricRows } =
        await import("@/server/features/ai-visibility/services/aiMetricRows");
      const { csv, truncated } = await loadAiMetricRows(
        aiMetricRowsSchema.parse({ ...q, projectId }),
      );
      return { csv, truncated };
    },
  },
  {
    pattern: new RegExp(`${PROJECT}/rank-trackers$`),
    describe: "GET /projects/{projectId}/rank-trackers",
    handle: (_m, _q, projectId) => RankTrackingService.getConfigs(projectId),
  },
  {
    pattern: new RegExp(`${PROJECT}/rank-trackers/([^/]+)$`),
    describe: "GET /projects/{projectId}/rank-trackers/{trackerId}",
    handle: (m, _q, projectId) =>
      RankTrackingService.getTracker(m[2], projectId),
  },
];

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError)
    return json({ error: "invalid_request", issues: error.issues }, 400);
  const code = asAppError(error)?.code;
  const status =
    code === "NOT_FOUND"
      ? 404
      : code === "FORBIDDEN"
        ? 403
        : code === "VALIDATION_ERROR"
          ? 400
          : 500;
  if (status === 500) console.error("[rest-api] 500:", describeError(error));
  return json({ error: status === 500 ? "internal_error" : code }, status);
}

async function authorizeProject(auth: Auth, projectId: string) {
  const allowed = await getAllowedProjectIds(
    auth.userId,
    auth.organizationId,
    auth.role,
  );
  if (!canAccessProject(allowed, projectId)) return false;
  return Boolean(
    await ProjectService.getProjectForOrganization(
      auth.organizationId,
      projectId,
    ),
  );
}

export async function handleRestApiRequest(
  request: Request,
  env: unknown,
): Promise<Response> {
  if (request.method !== "GET")
    return json({ error: "method_not_allowed" }, 405);
  try {
    const verified = await authenticateApiKeyRequest(request, env);
    if ("response" in verified) return verified.response;
    const { auth } = verified;
    const url = new URL(request.url);
    const path = url.pathname.slice(REST_API_PREFIX.length) || "/";

    if (path === "/")
      return json({
        endpoints: ["GET /projects", ...routes.map((route) => route.describe)],
      });
    if (path === "/projects") {
      const allowed = await getAllowedProjectIds(
        auth.userId,
        auth.organizationId,
        auth.role,
      );
      const projects = (
        await ProjectService.listProjects(auth.organizationId)
      ).filter((p) => canAccessProject(allowed, p.id));
      return json({
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          domain: p.domain,
          locationCode: p.locationCode,
          languageCode: p.languageCode,
        })),
      });
    }
    for (const route of routes) {
      const match = path.match(route.pattern);
      if (!match) continue;
      const projectId = decodeURIComponent(match[1]);
      // Same answer for a missing and a forbidden project, so ids can't be probed.
      if (!(await authorizeProject(auth, projectId)))
        return json({ error: "NOT_FOUND" }, 404);
      const result = await route.handle(
        match.map((part) => decodeURIComponent(part)),
        parseQuery(url.searchParams),
        projectId,
      );
      if (route.csv) {
        const { csv, truncated } = z
          .object({ csv: z.string(), truncated: z.boolean() })
          .parse(result);
        return new Response(csv, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "x-caldrin-truncated": String(truncated),
          },
        });
      }
      return json(result);
    }
    return json({ error: "NOT_FOUND" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
