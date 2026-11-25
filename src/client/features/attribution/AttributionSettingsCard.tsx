import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { QueryState } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { useAttributionSetup } from "@/client/features/attribution/useAttributionSetup";
import {
  type getAttributionSetupFn,
  saveAttributionSettingsFn,
} from "@/serverFunctions/attribution";
import { MODEL_KEYS, MODEL_LABELS } from "@/shared/attribution/vocabulary";

type Settings = Awaited<ReturnType<typeof getAttributionSetupFn>>["settings"];

/** Consent, lookback, currency and retention for the project's attribution. */
export function AttributionSettingsCard({ projectId }: { projectId: string }) {
  const { query, refresh } = useAttributionSetup(projectId);
  return (
    <CardShell title="Revenue attribution: settings">
      <QueryState
        query={query}
        loading={<Skeleton className="h-32 w-full" />}
        errorFallback="Failed to load attribution settings"
      >
        {(setup) => (
          <SettingsForm
            projectId={projectId}
            initial={setup.settings}
            onSaved={refresh}
          />
        )}
      </QueryState>
    </CardShell>
  );
}

function SettingsForm({
  projectId,
  initial,
  onSaved,
}: {
  projectId: string;
  initial: Settings;
  onSaved: () => unknown;
}) {
  const [value, setValue] = useState(initial);
  const save = useMutation({
    mutationFn: () =>
      saveAttributionSettingsFn({
        data: {
          projectId,
          ...value,
          defaultModel:
            MODEL_KEYS.find((m) => m === value.defaultModel) ??
            "last_non_direct",
        },
      }),
    onSuccess: async (result) => {
      toast.success(
        result.reprocessing
          ? "Saved. Credits are being rebuilt from your recorded events."
          : "Saved",
      );
      await onSaved();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const number =
    (key: "lookbackDays" | "retentionDays") =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setValue({ ...value, [key]: Number(event.target.value) });

  return (
    <form
      className="flex flex-col gap-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-col gap-1">
        <Label>Consent</Label>
        <SegmentedToggle
          showLabels
          value={value.consentMode}
          onChange={(consentMode) => setValue({ ...value, consentMode })}
          items={[
            { value: "required", icon: null, label: "Wait for consent" },
            { value: "implied", icon: null, label: "Consent not needed" },
          ]}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="attr-lookback">Lookback window (days)</Label>
          <Input
            id="attr-lookback"
            type="number"
            min={1}
            max={365}
            value={value.lookbackDays}
            onChange={number("lookbackDays")}
          />
          <span className="text-xs text-muted-foreground">
            A source more than this long before an outcome is not credited.
            Changing it rebuilds credits; recorded events are untouched.
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="attr-retention">Keep page views (days)</Label>
          <Input
            id="attr-retention"
            type="number"
            min={30}
            max={1825}
            value={value.retentionDays}
            onChange={number("retentionDays")}
          />
          <span className="text-xs text-muted-foreground">
            Signups, leads and payments are kept; page views older than this are
            deleted.
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="attr-currency">Reporting currency</Label>
          <Input
            id="attr-currency"
            maxLength={3}
            value={value.reportingCurrency}
            onChange={(e) =>
              setValue({
                ...value,
                reportingCurrency: e.target.value.toUpperCase(),
              })
            }
          />
          <span className="text-xs text-muted-foreground">
            Revenue in any other currency is shown separately, never converted.
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="attr-timezone">Time zone</Label>
          <Input
            id="attr-timezone"
            value={value.timezone}
            onChange={(e) => setValue({ ...value, timezone: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="attr-model">Default model</Label>
        <select
          id="attr-model"
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
          value={value.defaultModel}
          onChange={(e) => setValue({ ...value, defaultModel: e.target.value })}
        >
          {MODEL_KEYS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Button type="submit" disabled={save.isPending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
