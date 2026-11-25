import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { NavTab, NavTabs } from "@/client/components/NavTabs";
import { PageHeader } from "@/client/components/PageHeader";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { usesBetterAuthClient } from "@/lib/auth-mode";
import { isByokPreview } from "@/lib/byok-preview";
import { hasOrgPermission } from "@/lib/org-permissions";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/settings")({
  head: () => pageHead("Settings"),
  component: SettingsLayout,
});

function SettingsLayout() {
  const hasAccounts = usesBetterAuthClient();
  const org = useQuery({
    ...organizationContextQueryOptions(),
    enabled: hasAccounts,
  });
  const canReadAudit =
    !!org.data && hasOrgPermission(org.data.role, { organization: ["update"] });

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="space-y-4">
          <PageHeader title="Settings" />
          {hasAccounts && (
            <NavTabs label="Settings sections">
              <NavTab to="/settings/organization">Organization</NavTab>
              {!isByokPreview && (
                <NavTab to="/settings/billing">Billing</NavTab>
              )}
              {canReadAudit && <NavTab to="/settings/audit">Audit log</NavTab>}
            </NavTabs>
          )}
        </div>

        <Outlet />
      </div>
    </div>
  );
}
