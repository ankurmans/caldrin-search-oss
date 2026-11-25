import { z } from "zod";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import type { ToolContext } from "@/server/mcp/context";

// Every tool that changes data leaves an audit entry, whatever the outcome.
// Arguments are never stored: they can hold page copy, emails and keys.
export async function audited<Result>(
  tool: { name: string; config: object },
  args: unknown,
  auth: ToolContext["auth"],
  run: () => Promise<Result>,
) {
  const config = z
    .object({ annotations: z.object({ readOnlyHint: z.boolean() }) })
    .safeParse(tool.config);
  if (!config.success || config.data.annotations.readOnlyHint) return run();
  const projectId =
    z.object({ projectId: z.string().min(1) }).safeParse(args).data
      ?.projectId ?? null;
  let outcome: "success" | "failed" = "failed";
  try {
    const result = await run();
    const refused = z.object({ isError: z.literal(true) }).safeParse(result);
    outcome = refused.success ? "failed" : "success";
    return result;
  } finally {
    await AuditLogService.record({
      organizationId: auth.organizationId,
      projectId,
      action: "agent.tool_called",
      summary: `Ran ${tool.name}`,
      actorKind: "agent",
      actorUserId: auth.userId,
      actorLabel: auth.userEmail,
      actorClient: auth.clientLabel ?? null,
      targetKind: "mcp_tool",
      targetId: tool.name,
      outcome,
    });
  }
}
