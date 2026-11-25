import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { BrandingSettings } from "@/client/features/branding/BrandingSettings";
import { AlertDestinationsSettings } from "@/client/features/monitoring/AlertDestinationsSettings";
import { ApiKeySettings } from "@/client/features/settings/ApiKeySettings";
import { PrivacySettings } from "@/client/features/settings/PrivacySettings";
import { TeamSettings } from "@/client/features/team/TeamSettings";
import { WorkspaceKeysSettings } from "@/client/features/workspace-keys/WorkspaceKeysSettings";
import { usesBetterAuthClient } from "@/lib/auth-mode";

export const Route = createFileRoute("/_app/settings/organization")({
  // Access / no-auth self-host has no memberships or invitations — the
  // better-auth HTTP surface isn't even mounted there.
  beforeLoad: () => {
    if (!usesBetterAuthClient()) {
      throw notFound();
    }
  },
  component: OrganizationSettings,
});

function OrganizationSettings() {
  return (
    <div className="space-y-10">
      <TeamSettings />
      <div id="plans">
        <Link to="/settings/billing" className="text-sm underline">
          Manage billing and plans
        </Link>
      </div>
      <WorkspaceKeysSettings />
      <ApiKeySettings />
      <AlertDestinationsSettings />
      <BrandingSettings />
      <PrivacySettings />
    </div>
  );
}
