import { createFileRoute } from "@tanstack/react-router";

// Unauthenticated setup/health endpoint for self-hosters: reports per-feature
// configuration status (statuses and guidance only — never secret values) so
// "deployed but misconfigured" is diagnosable with one curl.
async function handleHealthRequest(): Promise<Response> {
  const { getSelfHostSetupStatus } = await import("@/server/lib/setup-status");
  const setup = await getSelfHostSetupStatus();
  const hasError = Object.values(setup.checks).some(
    (check) => check.status === "error",
  );

  return Response.json({ status: hasError ? "issues" : "ok", ...setup });
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => handleHealthRequest(),
    },
  },
});
