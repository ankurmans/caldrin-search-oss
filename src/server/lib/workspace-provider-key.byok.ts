import type { SearchProvider } from "@/server/lib/search-provider";
import { currentWorkspaceId } from "@/server/lib/workspace-scope";

export async function workspaceProviderKey(
  kind: SearchProvider,
): Promise<{ key: string | null }> {
  const organizationId = currentWorkspaceId();
  if (!organizationId) return { key: null };

  const { getCredential } =
    await import("@/server/features/workspace/credentials");
  const credential = await getCredential(organizationId, kind);
  return { key: credential?.apiKey ?? null };
}
