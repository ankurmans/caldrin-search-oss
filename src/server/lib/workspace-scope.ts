import { AsyncLocalStorage } from "node:async_hooks";

// Whose provider keys a call should use. Set where work starts (a request, an
// MCP tool call, a Workflow, a cron job) so the DataForSEO, TinyFish and LLM
// lookups deep below it can find the workspace without every function taking
// an organization id.
const scope = new AsyncLocalStorage<{ organizationId: string }>();

export function runInWorkspace<T>(organizationId: string, fn: () => T): T {
  return scope.run({ organizationId }, fn);
}

export function currentWorkspaceId(): string | null {
  return scope.getStore()?.organizationId ?? null;
}
