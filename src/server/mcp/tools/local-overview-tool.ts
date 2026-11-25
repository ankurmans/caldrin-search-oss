import { z } from "zod";
import { localOverview } from "@/server/features/local-seo/services/localOverview";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable } from "@/server/mcp/table";

export const getLocalOverviewTool = {
  name: "get_local_overview",
  config: {
    title: "Get local locations overview",
    description:
      "Every location saved in the project's local rank tracking side by side: address, keywords, check schedule, when it was last checked, and from that check the share of grid points where the business is in the top three and its average rank, with a row per keyword. Reads saved results only, starts no check and uses no credits. Checks are started and scheduled in the app under Local tracking; for a one-off grid on any business use get_local_rank_grid.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: z.looseObject({
      locations: z.array(
        z.looseObject({ trackerId: z.string(), title: z.string() }),
      ),
      notes: z.array(z.string()),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const result = await localOverview(args.projectId);
    const meta = buildProjectMeta(
      context,
      args.projectId,
      `/p/${args.projectId}/local-seo`,
    );
    return mcpResponse({
      text: [
        `${result.locations.length} saved locations.`,
        ...result.notes,
        formatMcpTable(result.locations, [
          { header: "Location", value: (l) => l.title },
          { header: "Keywords", value: (l) => l.keywords },
          { header: "Schedule", value: (l) => l.schedule ?? "manual" },
          { header: "Last checked", value: (l) => l.latestCheckAt ?? "never" },
          { header: "Top-3 points %", value: (l) => l.top3Percent ?? "" },
          { header: "Average rank", value: (l) => l.averageRank ?? "" },
        ]),
      ].join("\n"),
      meta,
      structuredContent: { ...result },
    });
  }),
};
