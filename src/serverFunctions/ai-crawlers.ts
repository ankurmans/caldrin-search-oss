import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  FIRST_SYNC_DAYS,
  connectCloudflare,
  disconnectCloudflare,
  syncCloudflareCrawlerHits,
} from "@/server/features/ai-crawlers/services/aiCrawlerCloudflare";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { checkCrawlerAccess } from "@/server/features/ai-crawlers/services/aiCrawlerAccess";
import { getCrawlerActivity } from "@/server/features/ai-crawlers/services/aiCrawlerActivity";
import { detectProjectHost } from "@/server/features/ai-crawlers/services/aiCrawlerHost";
import {
  getCrawlerSetup,
  rotateCrawlerKey,
} from "@/server/features/ai-crawlers/services/aiCrawlerKeys";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { crawlerSnippet } from "@/shared/ai-crawler-snippet";
import { aiProjectSchema } from "@/types/schemas/ai-visibility";
import {
  crawlerActivitySchema,
  crawlerCloudflareSchema,
} from "@/types/schemas/ai-crawlers";

export const getAiCrawlerSetup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(async ({ context }) => ({
    ...(await getCrawlerSetup(context.projectId)),
    snippet: crawlerSnippet(getPublicOrigin(getRequest())),
  }));

/** The new key is returned once; the previous key stops working. */
export const rotateAiCrawlerKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(async ({ context }) => {
    const result = await rotateCrawlerKey(context.projectId);
    await AuditLogService.recordUser(
      context,
      "crawler.key_rotated",
      "Created or replaced the AI crawler snippet key",
      { projectId: context.projectId },
    );
    return result;
  });

export const getAiCrawlerActivity = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(crawlerActivitySchema)
  .handler(({ data, context }) =>
    getCrawlerActivity(
      { ...data, projectId: context.projectId },
      context.project.domain,
    ),
  );

export const checkAiCrawlerAccess = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) => checkCrawlerAccess(context.projectId));

export const detectAiCrawlerHost = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) => detectProjectHost(context.projectId));

/** The token is checked, sealed and used to read the first month of visits. */
export const connectAiCrawlerCloudflare = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(crawlerCloudflareSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await connectCloudflare(
      context.projectId,
      data.token,
      context.allowedProjectIds ?? null,
    );
    if (result.connected)
      await AuditLogService.recordUser(
        context,
        "crawler.cloudflare_connected",
        `Connected Cloudflare analytics for ${result.zoneName}`,
        { projectId: context.projectId },
      );
    return result;
  });

export const syncAiCrawlerCloudflare = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) =>
    syncCloudflareCrawlerHits(context.projectId, FIRST_SYNC_DAYS),
  );

export const disconnectAiCrawlerCloudflare = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await disconnectCloudflare(context.projectId);
    await AuditLogService.recordUser(
      context,
      "crawler.cloudflare_disconnected",
      "Disconnected Cloudflare analytics",
      { projectId: context.projectId },
    );
  });
