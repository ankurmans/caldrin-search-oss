import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Switch } from "@/client/components/ui/switch";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getWorkspaceAlertDestinations,
  saveWorkspaceAlertDestinations,
} from "@/serverFunctions/monitoring";

const QUERY_KEY = ["workspace-alert-destinations"];

export function AlertDestinationsSettings() {
  const queryClient = useQueryClient();
  const [webhook, setWebhook] = useState("");
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getWorkspaceAlertDestinations(),
  });
  const save = useMutation({
    mutationFn: (data: {
      emailEnabled: boolean;
      slackWebhookUrl?: string | null;
    }) => saveWorkspaceAlertDestinations({ data }),
    onSuccess: () => {
      setWebhook("");
      toast.success("Alert destinations saved");
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  if (query.isPending) return <SkeletonCard />;
  if (query.isError)
    return (
      <QueryError
        error={query.error}
        fallback="Failed to load alert destinations"
      />
    );
  const data = query.data;
  // Members who cannot manage the workspace see nothing to change.
  if (!data.canManage) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Alert destinations"
        hint="New monitoring alerts always appear in the app. Choose where else they go."
      />
      <div className="flex items-center justify-between gap-4 rounded-md border p-4 text-sm">
        <div>
          <p className="font-medium">Email the workspace owners</p>
          <p className="text-muted-foreground">
            Sent once a day, only when the daily check writes an alert.
          </p>
        </div>
        <Switch
          checked={data.emailEnabled}
          disabled={save.isPending}
          onCheckedChange={(emailEnabled) => save.mutate({ emailEnabled })}
        />
      </div>
      <form
        className="space-y-2 rounded-md border p-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (webhook.trim())
            save.mutate({
              emailEnabled: data.emailEnabled,
              slackWebhookUrl: webhook.trim(),
            });
        }}
      >
        <p className="font-medium">Slack channel</p>
        <p className="text-muted-foreground">
          {data.slackConfigured
            ? "A webhook is connected. Paste a new one to replace it."
            : "Paste a Slack incoming webhook URL. A test message is posted before it is saved."}
        </p>
        <div className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            value={webhook}
            placeholder="https://hooks.slack.com/services/..."
            onChange={(event) => setWebhook(event.target.value)}
          />
          <Button type="submit" disabled={save.isPending || !webhook.trim()}>
            Save
          </Button>
          {data.slackConfigured ? (
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  emailEnabled: data.emailEnabled,
                  slackWebhookUrl: null,
                })
              }
            >
              Remove
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
