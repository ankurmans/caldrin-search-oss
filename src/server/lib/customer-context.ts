import type { EnsuredUserContext } from "@/middleware/ensure-user/types";

/** Who a metered call runs for: the workspace, plus the project when there is one. */
export type CustomerContext = Pick<
  EnsuredUserContext,
  "organizationId" | "userEmail" | "userId"
> & {
  projectId?: string;
};
