import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { AuthPageCard, AuthPageShell } from "@/client/features/auth/AuthPage";
import { useAuthRouteGuard } from "@/client/features/auth/useAuthRouteGuard";
import { PageLoading } from "@/client/components/Spinner";
import { Button } from "@/client/components/ui/button";
import { usesBetterAuthClient } from "@/lib/auth-mode";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedShellLayout,
});

function AuthenticatedShellLayout() {
  const authGate = useAuthRouteGuard();
  // MCP consent works wherever the app has its own accounts.
  if (!usesBetterAuthClient()) {
    return (
      <AuthPageShell>
        <AuthPageCard
          title="Not available"
          helperText="This page isn't available right now."
        >
          <Button
            nativeButton={false}
            render={<Link to="/" />}
            variant="secondary"
            className="w-full"
          >
            Back to Caldrin Search
          </Button>
        </AuthPageCard>
      </AuthPageShell>
    );
  }

  if (!authGate.canRenderAuthenticatedContent) {
    return <PageLoading />;
  }

  return (
    <AuthPageShell>
      <Outlet />
    </AuthPageShell>
  );
}
