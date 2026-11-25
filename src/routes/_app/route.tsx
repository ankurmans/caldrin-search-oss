import { useQuery } from "@tanstack/react-query";
import { ClientReportsPage } from "@/client/features/reports/ClientReportsPage";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { usesBetterAuthClient } from "@/lib/auth-mode";
import { isClientGuest } from "@/lib/org-permissions";
import { Outlet, createFileRoute, useParams } from "@tanstack/react-router";
import { useAuthRouteGuard } from "@/client/features/auth/useAuthRouteGuard";
import { TrialBanner } from "@/client/features/trial/TrialBanner";
import { AuthenticatedAppLayout } from "@/client/layout/AppShell";

export const Route = createFileRoute("/_app")({
  component: AppRouteLayout,
});

// One layout for app pages and project pages (/p/$projectId/...), so the
// drawer and setup modal keep their state when the user moves
// between the two.
function AppRouteLayout() {
  const authGate = useAuthRouteGuard();
  const { projectId } = useParams({ strict: false });
  // The page and banners render while the session check runs, so a page shows
  // its own skeleton from the first frame and loads its data alongside the
  // check. The check only redirects (signed out, unverified email): every
  // data call enforces auth on the server.
  const ready = authGate.canRenderAuthenticatedContent;

  const organization = useQuery({
    ...organizationContextQueryOptions(),
    enabled: ready && usesBetterAuthClient(),
  });
  if (organization.data && isClientGuest(organization.data.role))
    return <ClientReportsPage />;

  return (
    <AuthenticatedAppLayout
      projectId={projectId}
      ready={ready}
      banner={<TrialBanner />}
    >
      <Outlet />
    </AuthenticatedAppLayout>
  );
}
