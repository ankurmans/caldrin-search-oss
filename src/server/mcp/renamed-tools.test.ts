import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { createWorkersOAuthMcpProps } from "./context";
import { createCaldrinSearchMcpServer } from "./server";

vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
  DurableObject: class {
    readonly ctx = null;
  },
}));

describe("renamed MCP tools", () => {
  it("lists the American spelling and keeps the old name working, pointing at the new one", async () => {
    const server = createCaldrinSearchMcpServer(
      createWorkersOAuthMcpProps({
        userId: "user_test",
        userEmail: "test@example.com",
        organizationId: "org_test",
        baseUrl: "https://caldrin-search.test",
        clientId: "client_test",
        scopes: ["mcp"],
      }),
    );
    const client = new Client({ name: "renamed-tools", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const [oldName, newName] of [
        ["analyse_source_page", "analyze_source_page"],
        ["get_search_command_centre", "get_search_command_center"],
      ]) {
        expect(byName.has(newName)).toBe(true);
        expect(byName.get(oldName)?.description).toContain(
          `Old name of ${newName}`,
        );
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
