import { createFileRoute } from "@tanstack/react-router";
import { canAccessProject, hasOrgPermission } from "@/lib/org-permissions";
import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { completeShopifyOAuth } from "@/server/features/content/services/shopifyOAuthFlow";
import { AppError } from "@/server/lib/errors";
import { responseForAppError } from "@/server/lib/http-errors";

function redirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

// Shopify sends the merchant's browser here after they approve the app. The
// person's own session is required: the signed state must name them.
async function handleShopifyCallback(request: Request) {
  try {
    const context = await resolveUserContextFromHeaders(request.headers);
    const location = await completeShopifyOAuth({
      params: new URL(request.url).searchParams,
      user: context,
      authorizeProject: async (projectId) => {
        const project = await ProjectRepository.getProjectForOrganization(
          projectId,
          context.organizationId,
        );
        if (
          !project ||
          !canAccessProject(context.allowedProjectIds, projectId)
        ) {
          throw new AppError("NOT_FOUND");
        }
        if (!hasOrgPermission(context.role, { integration: ["manage"] })) {
          throw new AppError("FORBIDDEN");
        }
      },
    });
    return redirect(location);
  } catch (error) {
    // The browser is mid-redirect from Shopify, so show the error page rather
    // than a bare status body.
    if (error instanceof AppError) {
      return redirect(`/auth-error?error=${error.code.toLowerCase()}`);
    }
    return responseForAppError(error, "Shopify connection failed");
  }
}

export const Route = createFileRoute("/api/shopify/callback")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        handleShopifyCallback(request),
    },
  },
});
