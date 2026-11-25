import { mcpResponse } from "@/server/mcp/formatters";
import { type ToolContext } from "@/server/mcp/context";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { getTrialState } from "@/server/features/workspace/trial";
import { z } from "zod";

export const whoamiTool = {
  name: "whoami",
  config: {
    title: "Who am I",
    description:
      "Show the connected Caldrin Search account, token scopes, and whether the workspace is on its free test run. Use it when the user asks to check their account or connection. Uses no credits.",
    inputSchema: {} as Record<string, never>,
    outputSchema: z.looseObject({
      userEmail: z.string(),
      scopes: z.array(z.string()),
      trial: z.enum(["active", "ended", "none"]),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: async (_args: Record<string, never>, context: ToolContext) => {
    const auth = context.auth;
    const state = await getTrialState(auth.organizationId).catch(
      () => ({ phase: "none" }) as const,
    );
    const lines = [
      `Account: ${auth.userEmail}`,
      `Scopes: ${auth.scopes.length > 0 ? auth.scopes.join(", ") : "none"}`,
    ];
    if (state.phase === "active") {
      lines.push(
        `Free test run: $${Math.max(0, state.budgetUsd - state.spentUsd).toFixed(2)} left of $${state.budgetUsd.toFixed(2)}.`,
      );
    } else if (state.phase === "ended") {
      lines.push(
        "Free test run: used. The workspace owner adds provider keys in Settings to keep going.",
      );
    }
    return mcpResponse({
      text: lines.join("\n"),
      structuredContent: {
        userEmail: auth.userEmail,
        scopes: auth.scopes,
        trial: state.phase,
      },
    });
  },
};
