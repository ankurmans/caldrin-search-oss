import { createServerFn } from "@tanstack/react-start";
import { getTrialState } from "@/server/features/workspace/trial";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

// Where the workspace stands on its free test run, for the banner and the wall.
export const getTrialStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(({ context }) => getTrialState(context.organizationId));
