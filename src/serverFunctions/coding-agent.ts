import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { readCodingAgentPanel } from "@/server/features/coding-agent/codingAgentService";
import { requireProjectContext } from "@/serverFunctions/middleware";

export const getCodingAgentPanel = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(z.object({ projectId: z.string().min(1).max(100) }))
  .handler(({ context }) => {
    setResponseHeader("cache-control", "private, no-store");
    return readCodingAgentPanel(context);
  });
