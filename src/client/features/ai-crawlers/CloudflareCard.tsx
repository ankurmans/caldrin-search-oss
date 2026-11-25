import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { CLOUDFLARE_TOKEN_URL } from "@/shared/ai-crawler-handoff";
import {
  connectAiCrawlerCloudflare,
  disconnectAiCrawlerCloudflare,
  syncAiCrawlerCloudflare,
} from "@/serverFunctions/ai-crawlers";

type Connection = {
  zoneName: string;
  lastSyncedAt: string | null;
  lastError: string | null;
} | null;

export function CloudflareCard({
  projectId,
  connection,
  reusableZone,
}: {
  projectId: string;
  connection: Connection;
  reusableZone: string | null;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["ai-crawlers", projectId] });
  const onError = (error: unknown) =>
    toast.error(getStandardErrorMessage(error));

  const connect = useMutation({
    mutationFn: (pasted?: string) =>
      connectAiCrawlerCloudflare({ data: { projectId, token: pasted } }),
    onSuccess: async (result) => {
      if (result.connected) {
        setToken("");
        setReason(null);
        toast.success(`Connected ${result.zoneName}`);
        await refresh();
      } else setReason(result.reason ?? "Could not connect.");
    },
    onError,
  });
  const sync = useMutation({
    mutationFn: () => syncAiCrawlerCloudflare({ data: { projectId } }),
    onSuccess: refresh,
    onError,
  });
  const disconnect = useMutation({
    mutationFn: () => disconnectAiCrawlerCloudflare({ data: { projectId } }),
    onSuccess: refresh,
    onError,
  });

  return (
    <CardShell title="Cloudflare">
      {connection ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Reading AI crawler visits for{" "}
            <span className="font-medium">{connection.zoneName}</span> from
            Cloudflare's own analytics, counting only requests to that host and
            its www form.{" "}
            {connection.lastSyncedAt
              ? `Last synced ${connection.lastSyncedAt.slice(0, 16).replace("T", " ")} UTC, then refreshed daily.`
              : "Not synced yet."}
          </p>
          {connection.lastError ? (
            <p className="text-destructive">
              The last sync failed: {connection.lastError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              pending={sync.isPending}
              onClick={() => sync.mutate()}
            >
              Sync now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              pending={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            connect.mutate(token);
          }}
        >
          <p className="text-muted-foreground">
            Nothing to install. Open Cloudflare with the two read permissions
            already ticked, click Continue to summary and Create Token, then
            paste the token here. Caldrin reads only the count of AI crawler
            requests by path and status, and keeps the token encrypted. This
            only sees traffic that passes through Cloudflare: if your DNS
            records are set to "DNS only" (grey cloud), Cloudflare sees nothing.
          </p>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href={CLOUDFLARE_TOKEN_URL}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              Create the token in Cloudflare
            </Button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <Input
              type="password"
              autoComplete="off"
              aria-label="Cloudflare API token"
              placeholder="Cloudflare API token"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <Button
              type="submit"
              pending={connect.isPending}
              disabled={token.trim().length < 20}
            >
              Connect
            </Button>
          </div>
          {reusableZone ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                pending={connect.isPending}
                onClick={() => connect.mutate(undefined)}
              >
                Use the token already connected for {reusableZone}
              </Button>
              <span className="text-xs text-muted-foreground">
                It works only if that token is allowed on this zone too.
              </span>
            </div>
          ) : null}
          {reason ? <p className="text-destructive">{reason}</p> : null}
        </form>
      )}
    </CardShell>
  );
}
