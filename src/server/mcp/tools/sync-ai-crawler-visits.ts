import { z } from "zod";
import {
  FIRST_SYNC_DAYS,
  syncCloudflareCrawlerHits,
} from "@/server/features/ai-crawlers/services/aiCrawlerCloudflare";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const inputSchema = { projectId: projectIdSchema } as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const syncAiCrawlerVisitsTool = {
  name: "sync_ai_crawler_visits",
  config: {
    title: "Sync AI crawler visits from Cloudflare",
    description: `Reread the last ${FIRST_SYNC_DAYS} days of AI crawler visits for a project from its connected Cloudflare analytics, replacing the stored counts for those days. Counts only requests to the project's own host and www. Use it after connecting Cloudflare or when the numbers look stale. Does nothing when the project has no Cloudflare connection. Uses no credits.`,
    inputSchema,
    outputSchema: z.looseObject({
      synced: z.boolean(),
      connected: z.boolean(),
      error: z.string().nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const result = await syncCloudflareCrawlerHits(
      args.projectId,
      FIRST_SYNC_DAYS,
    );
    const connected = result.synced || "error" in result;
    const error = "error" in result ? result.error : null;
    return mcpResponse({
      text: !connected
        ? "This project has no Cloudflare connection, so there is nothing to sync."
        : error
          ? `Cloudflare sync failed: ${error}`
          : `Reread the last ${FIRST_SYNC_DAYS} days from Cloudflare.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/technical/ai-crawlers`,
      ),
      structuredContent: { synced: result.synced, connected, error },
    });
  }),
};
