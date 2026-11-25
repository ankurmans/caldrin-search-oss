import { isClientGuest } from "@/lib/org-permissions";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { codingAgentRepository } from "./codingAgentRepository";

type Viewer = { userId: string; projectId: string; role: string };

export async function readCodingAgentPanel(viewer: Viewer) {
  const grants = await getOptionalEnvValue("CODING_AGENT_STAFF_PROJECTS");
  const roles = viewer.role.split(",").map((role) => role.trim());
  if (
    isClientGuest(viewer.role) ||
    !roles.some((role) => role === "owner" || role === "admin") ||
    !grants
      ?.split(",")
      .map((grant) => grant.trim())
      .includes(`${viewer.projectId}:${viewer.userId}`)
  )
    return false as const;
  return codingAgentRepository.latestPanel(viewer.projectId);
}
