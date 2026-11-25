import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  WORKSPACE_LLM_MISSING_MESSAGE,
  getOpenRouterAccess,
  getWorkspaceLlmAccess,
} from "@/server/lib/openrouter";
import { getWorkersEnv } from "@/server/lib/runtime-env";
import { getWorkspaceMode } from "@/server/features/workspace/credentials";
import { requireProjectContext } from "@/serverFunctions/middleware";

const SAM_TRIAL_MESSAGE =
  "The AI agent is not part of the free test run. Add your own AI provider key in Settings, or upgrade to Cloud.";

const OPENROUTER_KEY_MISSING_MESSAGE =
  "OPENROUTER_API_KEY is not set for this deployment yet. Add it to your environment, restart Caldrin Search, then confirm here.";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });

type SamAccessStatus = {
  enabled: boolean;
  errorMessage: string | null;
};

// Gates the in-app AI agent (SAM) on an AI key being available: the
// workspace's own, or the deployment's OpenRouter key. A workspace on its free
// test run does not get the agent; its spend is not metered.
export const getSamAccessSetupStatus = createServerFn({ method: "GET" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }): Promise<SamAccessStatus> => {
    if ((await getWorkspaceMode(context.organizationId)) === "trial") {
      return { enabled: false, errorMessage: SAM_TRIAL_MESSAGE };
    }

    const workspace = await getWorkspaceLlmAccess(context.organizationId);
    if (workspace) {
      return workspace === "missing"
        ? { enabled: false, errorMessage: WORKSPACE_LLM_MISSING_MESSAGE }
        : { enabled: true, errorMessage: null };
    }

    const enabled = Boolean(getOpenRouterAccess((await getWorkersEnv()) ?? {}));
    return {
      enabled,
      errorMessage: enabled ? null : OPENROUTER_KEY_MISSING_MESSAGE,
    };
  });
