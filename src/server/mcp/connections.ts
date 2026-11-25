import { sortBy } from "remeda";
import { z } from "zod";
import { getCapturedOAuthHelpers } from "@/server/mcp/oauth-provider";
import { getWebChat } from "@/server/mcp/web-chat";

// "Connected agents" in Settings: OAuth grants. They live under the KV key
// grant:{userId}:{grantId}, so listUserGrants and revokeGrant can only ever
// reach the caller's own grants.

const grantMetadataSchema = z.looseObject({
  organizationId: z.string().optional(),
});

async function listMcpConnections(userId: string) {
  const oauth = getCapturedOAuthHelpers();
  // One page each: a person has a handful of agents, and a page holds a
  // thousand.
  const grants = (await oauth.listUserGrants(userId)).items;

  const oauthConnections = await Promise.all(
    grants.map(async (grant) => {
      const client = await oauth.lookupClient(grant.clientId);
      return {
        kind: "oauth" as const,
        id: grant.id,
        clientName: client?.clientName ?? "MCP client",
        webChat: getWebChat(client?.redirectUris ?? []),
        // The provider stores Unix seconds.
        createdAt: grant.createdAt * 1000,
        // Named on the client from the organizations the user belongs to,
        // the same way the API keys table does it.
        organizationId:
          grantMetadataSchema.safeParse(grant.metadata).data?.organizationId ??
          null,
      };
    }),
  );

  return sortBy(oauthConnections, [
    (connection) => connection.createdAt,
    "desc",
  ]);
}

const revokeMcpConnectionSchema = z.object({
  kind: z.literal("oauth"),
  grantId: z.string().min(1),
});

// An OAuth client's next call gets 401 and it has to authorize again.
async function revokeMcpConnection(
  userId: string,
  input: z.infer<typeof revokeMcpConnectionSchema>,
) {
  const { grantId } = input;
  const oauth = getCapturedOAuthHelpers();
  await oauth.revokeGrant(grantId, userId);
}

export const McpConnectionsService = {
  listMcpConnections,
  revokeMcpConnection,
};
