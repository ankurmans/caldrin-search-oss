import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { GoogleGlyph } from "@/client/features/gsc/GoogleGlyph";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import { GoogleLinkErrorAlert } from "@/client/features/integrations/GoogleLinkErrorAlert";
import { googleConnectionOptions } from "@/client/features/integrations/googleProviders";
import {
  startGoogleLink,
  useGoogleLinkPending,
} from "@/client/features/integrations/startGoogleLink";
import { setDashboardStepDismissed } from "@/serverFunctions/dashboard";

export function DashboardGoogleSetup({
  projectId,
  expanded,
}: {
  projectId: string;
  expanded: boolean;
}) {
  const queryClient = useQueryClient();
  const busy = useGoogleLinkPending();
  const gsc = useQuery({
    ...googleConnectionOptions("gsc", projectId),
    enabled: expanded,
  });
  const ga4 = useQuery({
    ...googleConnectionOptions("ga4", projectId),
    enabled: expanded,
  });
  const checking = expanded && (gsc.isPending || ga4.isPending);
  const needsGrant =
    expanded &&
    !checking &&
    gsc.data?.canManage &&
    gsc.data.googleOAuthConfigured &&
    !gsc.data.currentUserHasGrant &&
    !ga4.data?.currentUserHasGrant;
  const showPickers = expanded && !checking && !needsGrant;
  const skip = useMutation({
    mutationFn: () =>
      setDashboardStepDismissed({
        data: { projectId, step: "google", dismissed: true },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["dashboardActivation", projectId],
      }),
  });

  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-5"
      aria-labelledby="dashboard-google-heading"
    >
      <h2 id="dashboard-google-heading" className="text-lg font-semibold">
        Connect Google
      </h2>
      <p className="text-sm text-muted-foreground">
        Add Search Console and Analytics data to your project, or continue with
        what’s available.
      </p>
      {!showPickers && <GoogleLinkErrorAlert provider="gsc" />}
      <div className="flex flex-wrap items-center gap-2">
        {!expanded && (
          <Button
            nativeButton={false}
            render={
              <Link
                to="/p/$projectId"
                params={{ projectId }}
                search={{ setup: "google" }}
              />
            }
          >
            Connect Google
          </Button>
        )}
        {checking && (
          <span role="status" className="text-sm text-muted-foreground">
            Checking your Google connections…
          </span>
        )}
        {needsGrant && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void startGoogleLink("gsc", window.location.href, true)
            }
          >
            <GoogleGlyph /> Authorize Search Console and Analytics
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={skip.isPending}
          onClick={() => skip.mutate()}
        >
          Skip for now
        </Button>
      </div>
      {showPickers && (
        <div className="grid gap-4 md:grid-cols-2">
          <GoogleConnectionCard provider="gsc" projectId={projectId} />
          <GoogleConnectionCard provider="ga4" projectId={projectId} />
        </div>
      )}
    </section>
  );
}
