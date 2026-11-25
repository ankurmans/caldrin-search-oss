import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { removeAttributionConnectorFn } from "@/serverFunctions/attributionReports";
import {
  createPosthogConnectorFn,
  importPosthogFn,
  testPosthogConnectorFn,
} from "@/serverFunctions/attributionPosthog";
import { useAttributionConnectors } from "./attributionQueries";
import { attributionKey } from "./useAttributionSetup";

const REGIONS = [
  { value: "us", label: "US cloud (us.posthog.com)" },
  { value: "eu", label: "EU cloud (eu.posthog.com)" },
];

const MAX_DAYS = 31;
const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const isoDay = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

type Preview = Extract<
  Awaited<ReturnType<typeof importPosthogFn>>,
  { ok: true }
>["value"];

function ImportPanel({
  projectId,
  connectorId,
}: {
  projectId: string;
  connectorId: string;
}) {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(isoDay(7));
  const [to, setTo] = useState(isoDay(0));
  const [result, setResult] = useState<{
    key: string;
    data: Preview;
  } | null>(null);
  const key = `${from}|${to}`;
  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      importPosthogFn({
        data: { projectId, id: connectorId, from, to, dryRun },
      }),
    onSuccess: async (outcome, dryRun) => {
      if (!outcome.ok) {
        toast.error(outcome.reason);
        return;
      }
      const data = outcome.value;
      setResult({ key, data });
      if (!dryRun)
        await queryClient.invalidateQueries({
          queryKey: attributionKey(projectId),
        });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "The import did not work")),
  });
  const preview = result?.key === key ? result.data : null;
  const unregistered = preview ? Object.entries(preview.unregistered) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`ph-from-${connectorId}`}>From</Label>
          <Input
            id={`ph-from-${connectorId}`}
            type="date"
            value={from}
            min={shiftDay(to, -(MAX_DAYS - 1))}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ph-to-${connectorId}`}>To (included)</Label>
          <Input
            id={`ph-to-${connectorId}`}
            type="date"
            value={to}
            min={from}
            max={isoDay(0)}
            onChange={(e) => {
              const next = e.target.value;
              setTo(next);
              // Keep the range valid: at most MAX_DAYS and never inverted.
              if (
                next &&
                (from > next || from < shiftDay(next, -(MAX_DAYS - 1)))
              )
                setFrom(shiftDay(next, -6));
            }}
          />
        </div>
        <Button
          variant="outline"
          pending={run.isPending && run.variables}
          disabled={run.isPending || !from || !to}
          onClick={() => run.mutate(true)}
        >
          Preview
        </Button>
        <Button
          pending={run.isPending && !run.variables}
          disabled={
            run.isPending ||
            !preview ||
            preview.imported !== null ||
            preview.wouldAdd === 0
          }
          onClick={() => run.mutate(false)}
        >
          Import
        </Button>
      </div>
      {preview ? (
        <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
          <p>
            {preview.pageViews} page views and {preview.identifies} identify
            calls read from {preview.from} to {preview.to}.{" "}
            {preview.imported
              ? `${preview.imported.accepted} added, ${preview.imported.duplicate} already held, ${preview.imported.rejected} refused.`
              : `${preview.wouldAdd} would be added, ${preview.alreadyHeld} already held.`}
          </p>
          <p className="text-muted-foreground">
            {preview.sessionsWithSource} sessions recorded where the visit came
            from. {preview.sessionsWithoutSource} did not; they are kept as page
            views and any outcome that follows them stays Unknown.
          </p>
          {unregistered.length > 0 ? (
            <p className="text-muted-foreground">
              Skipped, not a registered website:{" "}
              {unregistered
                .slice(0, 5)
                .map(([host, n]) => `${host} (${n})`)
                .join(", ")}
              .
            </p>
          ) : null}
          {preview.truncated ? (
            <p className="text-warning">
              This range holds more than {preview.budget} events, so only the
              oldest were read. Import a shorter range, then the next one.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Preview what the date range will add. Imports run on demand.
        </p>
      )}
    </div>
  );
}

export function PosthogConnect({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useAttributionConnectors(projectId);
  const [label, setLabel] = useState("");
  const [region, setRegion] = useState("us");
  const [posthogProjectId, setPosthogProjectId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [checked, setChecked] = useState<Record<string, string>>({});
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: attributionKey(projectId) });
  const fail = (error: unknown) =>
    toast.error(getStandardErrorMessage(error, "That did not work"));

  const create = useMutation({
    mutationFn: () =>
      createPosthogConnectorFn({
        data: {
          projectId,
          label: label.trim(),
          posthogProjectId: posthogProjectId.trim(),
          ...(apiKey.trim()
            ? { region: region === "eu" ? ("eu" as const) : ("us" as const) }
            : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      }),
    onSuccess: async (outcome) => {
      if (!outcome.ok) {
        toast.error(outcome.reason);
        return;
      }
      const made = outcome.value;
      toast.success(
        `Connected. PostHog holds ${made.pageViews} page views and ${made.identifies} identify calls from the last 7 days.`,
      );
      setLabel("");
      setPosthogProjectId("");
      setApiKey("");
      setAdding(false);
      await refresh();
    },
    onError: fail,
  });
  const test = useMutation({
    mutationFn: (id: string) =>
      testPosthogConnectorFn({ data: { projectId, id } }),
    onSuccess: (outcome, id) => {
      if (!outcome.ok) {
        setChecked((prev) => ({ ...prev, [id]: outcome.reason }));
        toast.error(outcome.reason);
        return;
      }
      const counts = outcome.value;
      const message = `Working. ${counts.pageViews} page views and ${counts.identifies} identify calls in the last 7 days.`;
      setChecked((prev) => ({ ...prev, [id]: message }));
      toast.success(message);
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      removeAttributionConnectorFn({ data: { projectId, id } }),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <QueryState
      query={query}
      loading={<Skeleton className="h-24 w-full" />}
      errorFallback="Failed to load connectors"
    >
      {({ connectors, reusablePosthog }) => {
        const hasPosthog = connectors.some((c) => c.kind === "posthog");
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Import visits and campaign data for your registered websites.
            </p>
            {connectors
              .filter((c) => c.kind === "posthog")
              .map((c) => (
                <div
                  key={c.id}
                  className="space-y-3 rounded-lg border border-border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.label}</span>
                    <Badge variant={c.lastEventAt ? "success" : "outline"}>
                      {c.lastEventAt
                        ? `Last import ${formatRelativeTime(c.lastEventAt)}`
                        : "Nothing imported yet"}
                    </Badge>
                    {c.lastFailure ? (
                      <Badge variant="warning">{c.lastFailure}</Badge>
                    ) : null}
                    <Button
                      size="xs"
                      variant="outline"
                      className="ml-auto"
                      pending={test.isPending && test.variables === c.id}
                      disabled={test.isPending}
                      onClick={() => test.mutate(c.id)}
                    >
                      Test connection
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(c.id)}
                    >
                      Remove
                    </Button>
                  </div>
                  {checked[c.id] && (
                    <p className="text-muted-foreground">{checked[c.id]}</p>
                  )}
                  <ImportPanel projectId={projectId} connectorId={c.id} />
                </div>
              ))}
            {hasPosthog && !adding ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAdding(true)}
              >
                Add another PostHog connection
              </Button>
            ) : (
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="posthog-label">Name</Label>
                  <Input
                    id="posthog-label"
                    value={label}
                    placeholder="Product analytics"
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
                {reusablePosthog && !apiKey.trim() ? null : (
                  <div className="space-y-1.5">
                    <Label htmlFor="posthog-region">Region</Label>
                    <Select
                      items={REGIONS}
                      value={region}
                      onValueChange={(v) => v && setRegion(v)}
                    >
                      <SelectTrigger id="posthog-region" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REGIONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="posthog-project">PostHog project id</Label>
                  <Input
                    id="posthog-project"
                    name="posthog-project-id"
                    autoComplete="off"
                    inputMode="numeric"
                    value={posthogProjectId}
                    placeholder="12345"
                    onChange={(e) => setPosthogProjectId(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="posthog-key">Personal API key</Label>
                  <Input
                    id="posthog-key"
                    name="posthog-personal-api-key"
                    type="password"
                    autoComplete="new-password"
                    value={apiKey}
                    placeholder={
                      reusablePosthog
                        ? `Leave empty to use the key from ${reusablePosthog.projectName}`
                        : "phx_…"
                    }
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use a personal key with <code>query:read</code> for this
                    project.
                    {reusablePosthog &&
                      " Leave blank to reuse a key that can read this project."}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <Button
                    type="submit"
                    disabled={
                      !label.trim() ||
                      !posthogProjectId.trim() ||
                      (!apiKey.trim() && !reusablePosthog) ||
                      create.isPending
                    }
                  >
                    Add PostHog
                  </Button>
                </div>
              </form>
            )}
            <details className="space-y-2 text-sm">
              <summary className="cursor-pointer">Visit attribution</summary>
              <p className="text-muted-foreground">
                Use the same user ID in PostHog identify calls, signups and
                payments. Visits with an unrecorded source stay Unknown.
              </p>
            </details>
          </div>
        );
      }}
    </QueryState>
  );
}
