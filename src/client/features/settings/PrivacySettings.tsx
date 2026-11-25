import { SectionHeader } from "@/client/components/PageHeader";
import {
  updatePrivacyChoices,
  usePrivacyChoices,
} from "@/client/components/PrivacyChoices";
import { Switch } from "@/client/components/ui/switch";

export function PrivacySettings() {
  const choices = usePrivacyChoices();
  if (!choices) return null;

  return (
    <section className="space-y-3">
      <SectionHeader title="Privacy" />
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm">Usage analytics</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Share usage analytics and session replays to help improve Caldrin
            Search.
          </p>
        </div>
        <Switch
          checked={choices.analytics}
          onCheckedChange={(analytics) =>
            void updatePrivacyChoices({ ...choices, analytics }, true)
          }
          aria-label="Share usage analytics"
        />
      </div>
    </section>
  );
}
