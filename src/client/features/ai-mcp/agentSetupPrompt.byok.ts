export const agentUpdatePrompt =
  "Use your MCP client's connection settings to reconnect to this installation and refresh the tool list.";

export function getAgentSetupPrompt(origin: string) {
  return `Connect to my Caldrin Search installation at ${origin}/mcp. Use the client's supported authorization flow and show me the available project-scoped tools.`;
}
