import type { z } from "zod";
import type { CustomerContext } from "@/server/lib/customer-context";
import type { AiVisibilityService } from "@/server/features/ai-visibility/services/AiVisibilityService";
import { AiVisibilityError } from "@/server/features/ai-visibility/services/aiVisibilityErrors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { aiToolOutput } from "./ai-visibility-output-schemas";

function recoveryFor(error: AiVisibilityError) {
  if (error.runId)
    return `Read get_ai_visibility_run for run ${error.runId}. Do not start another check to poll it.`;
  if (error.reason === "COST_LIMIT_EXCEEDED")
    return "Call estimate_ai_visibility_cost for the current price, then retry with its runNowCostUsd as maxCostUsd.";
  return "Read get_ai_visibility_tracker and resolve the reported issue before retrying.";
}

// Keep collection clients out of the MCP/SAM startup graph. Auth always runs
// before this import or any service operation, including quotes and exports.
export function defineAiTool<
  Shape extends z.ZodRawShape & { projectId: z.ZodString },
  Output extends z.ZodType,
>(options: {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject<Shape>;
  output: Output;
  readOnly: boolean;
  openWorld?: boolean;
  path?: "sources" | "research" | "crawlers";
  execute: (
    service: typeof AiVisibilityService,
    args: z.infer<z.ZodObject<Shape>> & { projectId: string },
    billing: CustomerContext,
    baseUrl: string,
    // Parsed against `output` below; loose output objects add an index
    // signature that the service's DTO interfaces do not declare.
  ) => Promise<unknown>;
  summarize: (data: z.infer<Output>) => string;
}) {
  return {
    name: options.name,
    config: {
      title: options.title,
      description: options.description,
      inputSchema: options.input.shape,
      outputSchema: aiToolOutput(options.output),
      annotations: {
        readOnlyHint: options.readOnly,
        openWorldHint: options.openWorld ?? false,
        destructiveHint: false,
      },
    },
    handler: withMcpProjectAuth(
      async (
        args: z.infer<z.ZodObject<Shape>> & { projectId: string },
        context,
      ) => {
        const meta = buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/ai-visibility${options.path ? `/${options.path}` : ""}`,
        );
        try {
          const { AiVisibilityService: service } =
            await import("@/server/features/ai-visibility/services/AiVisibilityService");
          const data = options.output.parse(
            await options.execute(
              service,
              args,
              context.billing,
              context.baseUrl,
            ),
          );
          return mcpResponse({
            // Some MCP clients expose only text content to the model. Keep
            // the same validated public evidence and recovery IDs in both forms.
            text: `${options.summarize(data)}\n${meta.url}\n${JSON.stringify({ status: "success", data })}`,
            meta,
            structuredContent: { status: "success" as const, data },
          });
        } catch (error) {
          if (!(error instanceof AiVisibilityError)) throw error;
          const recovery = recoveryFor(error);
          return {
            ...mcpResponse({
              text: `${error.message} ${recovery}\n${meta.url}`,
              meta,
              structuredContent: {
                status: "error" as const,
                code: error.reason,
                message: error.message,
                recovery,
                ...(error.runId ? { runId: error.runId } : {}),
              },
            }),
            isError: true,
          };
        }
      },
    ),
  };
}
