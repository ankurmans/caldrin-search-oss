import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { QueryState } from "@/client/components/QueryState";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { clearLastProjectId } from "@/client/lib/active-project";
import { signOutAndRedirect } from "@/lib/auth-client";
import { getClientReports } from "@/serverFunctions/clientReports";
import { switchOrganization } from "@/serverFunctions/organization";

export function ClientReportsPage() {
  const organization = useQuery(organizationContextQueryOptions());
  const reports = useQuery({
    queryKey: ["client-reports", organization.data?.organizationId],
    queryFn: () => getClientReports(),
    staleTime: 0,
  });
  const switchWorkspace = useMutation({
    mutationFn: (organizationId: string) =>
      switchOrganization({ data: { organizationId } }),
    onSuccess: () => {
      clearLastProjectId();
      window.location.assign("/");
    },
  });
  const brand = reports.data?.brand;
  const projectNames = new Map(
    reports.data?.projects.map(({ id, name }) => [id, name]),
  );
  const workspaces = organization.data?.organizations ?? [];

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-5 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          {brand?.logoUrl && (
            <img
              src={brand.logoUrl}
              alt=""
              className="h-9 max-w-28 object-contain"
              referrerPolicy="no-referrer"
            />
          )}
          <div>
            <p className="text-sm text-muted-foreground">
              {brand?.name ?? organization.data?.organizationName}
            </p>
            <h1 className="text-xl font-semibold">Client reports</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && (
            <select
              aria-label="Workspace"
              value={organization.data?.organizationId ?? ""}
              disabled={switchWorkspace.isPending}
              onChange={(event) =>
                switchWorkspace.mutate(event.currentTarget.value)
              }
              className="max-w-44 rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {workspaces.map((workspace) => (
                <option
                  key={workspace.organizationId}
                  value={workspace.organizationId}
                >
                  {workspace.organizationName}
                </option>
              ))}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={signOutAndRedirect}>
            Sign out
          </Button>
        </div>
      </header>
      {switchWorkspace.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not switch workspaces. Try again.
        </p>
      )}
      <QueryState
        query={reports}
        errorFallback="Could not load client reports."
      >
        {(data) =>
          data.reports.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {data.reports.map((report) => (
                <li
                  key={report.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-4 py-3 hover:bg-muted"
                >
                  <a
                    href={`/r/${encodeURIComponent(report.id)}`}
                    target="_blank"
                    rel="noopener"
                    className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2"
                  >
                    <span className="break-words font-medium">
                      {report.title}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {projectNames.get(report.projectId)} ·{" "}
                      {report.updatedAt.slice(0, 10)}
                    </span>
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={
                      <a
                        href={`/r/${encodeURIComponent(report.id)}?print=1`}
                        target="_blank"
                        rel="noopener"
                        aria-label={`Save ${report.title} as PDF`}
                      />
                    }
                  >
                    Save as PDF
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">
              {data.active
                ? "Your agency hasn’t published any reports to your account yet."
                : "Client access is paused. Contact your agency if you need a report."}
            </p>
          )
        }
      </QueryState>
    </main>
  );
}
