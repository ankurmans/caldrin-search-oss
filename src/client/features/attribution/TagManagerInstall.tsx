import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { QueryState } from "@/client/components/QueryState";
import { GoogleLinkErrorAlert } from "@/client/features/integrations/GoogleLinkErrorAlert";
import {
  disconnectTagManager,
  getTagManagerSetup,
  proposeTagManagerInstall,
  rollbackTagManagerInstall,
  stageTagManagerInstall,
  startTagManagerLink,
  verifyTagManagerInstall,
} from "@/serverFunctions/tag-manager";

export function TagManagerInstall({
  projectId,
  properties,
  hasSnippet,
}: {
  projectId: string;
  properties: { host: string }[];
  hasSnippet: boolean;
}) {
  const queryClient = useQueryClient();
  const [container, setContainer] = useState("");
  const [selectedHost, setSelectedHost] = useState("");
  const hostname = selectedHost || properties[0]?.host || "";
  const queryKey = ["attributionTagManager", projectId] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => getTagManagerSetup({ data: { projectId } }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const authorize = useMutation({
    mutationFn: () =>
      startTagManagerLink({
        data: { projectId, callbackURL: window.location.href },
      }),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
  const disconnect = useMutation({
    mutationFn: () => disconnectTagManager({ data: { projectId } }),
    onSuccess: refresh,
  });
  const propose = useMutation({
    mutationFn: () =>
      proposeTagManagerInstall({ data: { projectId, container, hostname } }),
    onSuccess: refresh,
  });
  const stage = useMutation({
    mutationFn: (entryId: string) =>
      stageTagManagerInstall({ data: { projectId, entryId } }),
    onSettled: refresh,
  });
  const verify = useMutation({
    mutationFn: (entryId: string) =>
      verifyTagManagerInstall({ data: { projectId, entryId } }),
    onSuccess: async ({ published }) => {
      if (published) toast.success("Live tracker tag verified");
      else
        toast.info(
          "Tag Manager has not confirmed this tracker tag in the live version.",
        );
      await refresh();
    },
  });
  const rollback = useMutation({
    mutationFn: (entryId: string) =>
      rollbackTagManagerInstall({ data: { projectId, entryId } }),
    onSuccess: refresh,
  });
  const busy =
    authorize.isPending ||
    disconnect.isPending ||
    propose.isPending ||
    stage.isPending ||
    verify.isPending ||
    rollback.isPending;

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-muted-foreground">
        Caldrin creates a draft tag in a separate workspace. You preview and
        publish it in Tag Manager.
      </p>
      {!hasSnippet && (
        <p className="text-muted-foreground">
          Add your website above to generate its tracker first.
        </p>
      )}
      <GoogleLinkErrorAlert provider="gsc" integrationLabel="Tag Manager" />
      <QueryState
        query={query}
        errorFallback="Could not load Tag Manager setup"
        loading={<p className="text-muted-foreground">Checking Tag Manager…</p>}
      >
        {({ connected, canManage, entries }) => (
          <>
            {canManage &&
              (connected ? (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    propose.mutate();
                  }}
                >
                  <label className="flex flex-col gap-1">
                    Website
                    <select
                      className="h-9 rounded-md border bg-background px-2"
                      value={hostname}
                      onChange={(event) =>
                        setSelectedHost(event.currentTarget.value)
                      }
                    >
                      {properties.map(({ host }) => (
                        <option key={host}>{host}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    Tag Manager workspace URL
                    <Input
                      value={container}
                      onChange={(event) =>
                        setContainer(event.currentTarget.value)
                      }
                      placeholder="https://tagmanager.google.com/…"
                      aria-describedby="tag-manager-workspace-help"
                    />
                  </label>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      busy || !hasSnippet || !hostname || !container.trim()
                    }
                  >
                    Review install plan
                  </Button>
                </form>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => authorize.mutate()}
                >
                  Connect Google Tag Manager
                </Button>
              ))}

            {connected && canManage && (
              <p
                id="tag-manager-workspace-help"
                className="text-xs text-muted-foreground"
              >
                Open your website’s container in Tag Manager, select Workspace,
                and copy the URL from your browser.
              </p>
            )}

            {connected && canManage && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => disconnect.mutate()}
              >
                Disconnect Tag Manager account
              </Button>
            )}
            {entries.map((entry) => (
              <section
                key={entry.id}
                className="space-y-2 rounded-md border p-3"
              >
                <p className="font-medium">
                  {entry.containerName} · {entry.containerId}
                </p>
                <p className="text-muted-foreground">{entry.action}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.status === "rolled_back"
                    ? "Rolled back"
                    : entry.publication === "published"
                      ? "Live tag verified"
                      : entry.status === "executed"
                        ? "Draft workspace verified"
                        : entry.status === "failed"
                          ? "Failed"
                          : "Awaiting approval"}
                  {" · Updated "}
                  {new Date(entry.lastUse).toLocaleDateString()}
                </p>
                {entry.error && (
                  <p className="text-sm text-destructive">{entry.error}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {canManage &&
                    (entry.status === "proposed" ||
                      entry.status === "approved") && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => stage.mutate(entry.id)}
                      >
                        Approve and create draft
                      </Button>
                    )}
                  {entry.status === "executed" && (
                    <>
                      <a
                        href={entry.containerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center underline"
                      >
                        Open in Tag Manager
                      </a>
                      {canManage && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => verify.mutate(entry.id)}
                          >
                            Verify published tag
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => rollback.mutate(entry.id)}
                          >
                            {entry.publication === "published"
                              ? "Verify removal"
                              : "Remove draft tag"}
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
                {entry.publication === "draft" &&
                  entry.status === "executed" && (
                    <p className="text-xs text-muted-foreground">
                      Open the draft in Tag Manager, then select Submit and
                      Publish. Google may ask the account owner to accept its
                      terms for custom tags. Return here to verify the published
                      tag.
                    </p>
                  )}
                {entry.publication === "published" &&
                  entry.status === "executed" && (
                    <p className="text-xs text-muted-foreground">
                      Use Check installation below to confirm the tracker sends
                      data from your site. To undo the install, remove the tag
                      in Tag Manager, publish, then select Verify removal here.
                    </p>
                  )}
              </section>
            ))}
          </>
        )}
      </QueryState>
    </div>
  );
}
