import { createFileRoute, redirect } from "@tanstack/react-router";
import { SectionHeader } from "@/client/components/PageHeader";
import { ThemePreferenceRadio } from "@/client/components/ThemePreferenceMenuItems";
import { PrivacySettings } from "@/client/features/settings/PrivacySettings";
import { usesBetterAuthClient } from "@/lib/auth-mode";

export const Route = createFileRoute("/_app/settings/")({
  beforeLoad: ({ location }) => {
    if (usesBetterAuthClient()) {
      throw redirect({
        to: "/settings/organization",
        hash: location.hash,
        replace: true,
      });
    }
  },
  component: SelfHostedSettings,
});

function SelfHostedSettings() {
  return (
    <div className="max-w-xl space-y-10">
      <section className="space-y-3">
        <SectionHeader title="Appearance" />
        <div className="flex items-center justify-between gap-6">
          <span className="text-sm">Theme</span>
          <ThemePreferenceRadio />
        </div>
      </section>
      <PrivacySettings />
    </div>
  );
}
