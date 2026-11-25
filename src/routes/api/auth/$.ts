import { getActiveOrganizationId } from "@/lib/auth-session";
import { isClientGuest } from "@/lib/org-permissions";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { getAuth, hasBetterAuthConfig } from "@/lib/auth";
import { usesBetterAuth } from "@/lib/auth-mode";

const rosterPaths = new Set([
  "/api/auth/organization/get-full-organization",
  "/api/auth/organization/list-members",
]);

async function canReadRoster(request: Request, url: URL) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return false;
  const slug = url.searchParams.get("organizationSlug");
  const organizationId = slug
    ? (await auth.api.listOrganizations({ headers: request.headers })).find(
        (org) => org.slug === slug,
      )?.id
    : url.searchParams.get("organizationId") ||
      getActiveOrganizationId(session);
  if (!organizationId) return false;
  const membership = await AuthRepository.getMembership(
    session.user.id,
    organizationId,
  );
  return !!membership && !isClientGuest(membership.role);
}

async function handleAuthRequest(request: Request) {
  if (!usesBetterAuth(env.AUTH_MODE)) {
    return new Response("Not found", {
      status: 404,
    });
  }

  if (!hasBetterAuthConfig()) {
    return new Response("Missing Better Auth configuration", {
      status: 500,
    });
  }

  // Per-IP throttle on password sign-in so passwords can't be guessed at
  // machine speed. Better Auth's own limiter is in-memory, which on Workers
  // is per isolate, so it never engages. The binding is declared in
  // deploy/alchemy/alchemy.run.ts; the wrangler.jsonc surfaces (local dev)
  // doesn't have it and skip limiting.
  const ip = request.headers.get("cf-connecting-ip");
  if (
    env.AUTH_RATE_LIMIT &&
    ip &&
    request.method === "POST" &&
    new URL(request.url).pathname === "/api/auth/sign-in/email"
  ) {
    const { success } = await env.AUTH_RATE_LIMIT.limit({ key: ip });
    if (!success) {
      return Response.json(
        { message: "Too many sign-in attempts. Try again in a minute." },
        { status: 429 },
      );
    }
  }

  const url = new URL(request.url);
  if (
    rosterPaths.has(url.pathname.replace(/\/+$/, "")) &&
    !(await canReadRoster(request, url))
  ) {
    return Response.json(
      { message: "Workspace roster access denied." },
      { status: 403 },
    );
  }
  return getAuth().handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        return handleAuthRequest(request);
      },
      POST: async ({ request }: { request: Request }) => {
        return handleAuthRequest(request);
      },
    },
  },
});
