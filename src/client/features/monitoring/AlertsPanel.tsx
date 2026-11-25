import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { formatTime, humanize } from "@/client/features/ledger/helpers";
import {
  listProjectAlerts,
  markProjectAlertsRead,
} from "@/serverFunctions/monitoring";

const PAGE_SIZE = 25;

type AlertList = Awaited<ReturnType<typeof listProjectAlerts>>;
type ProjectAlert = AlertList["alerts"][number];

const alertsKey = (projectId: string) => ["project-alerts", projectId] as const;

function conditionsLine(conditions: ProjectAlert["conditions"]) {
  if (!conditions) return null;
  const version =
    conditions.promptSetVersion === null
      ? "prompt set"
      : `prompt set v${conditions.promptSetVersion}`;
  const sides = [conditions.before, conditions.after]
    .filter((side) => side !== null)
    .map(
      (side) => `${side.period}: ${side.runs} runs, ${side.answered} answered`,
    )
    .join(" vs ");
  return `${version} · ${conditions.engines.join(", ")} · ${conditions.markets.join(", ")} · ${sides}`;
}

export function AlertsPanel({ projectId }: { projectId: string }) {
  const [offset, setOffset] = useState(0);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...alertsKey(projectId), offset],
    queryFn: () =>
      listProjectAlerts({ data: { projectId, limit: PAGE_SIZE, offset } }),
    placeholderData: keepPreviousData,
  });
  const markRead = useMutation({
    mutationFn: (alertIds: string[] | "all") =>
      markProjectAlertsRead({ data: { projectId, alertIds } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: alertsKey(projectId) }),
    onError: () => toast.error("Could not mark the alert read."),
  });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Alerts"
        description="Changes the daily check found in stored AI visibility answers, and a weekly summary. Each alert states what was compared and whether the difference is outside run-to-run noise. Nothing here starts a paid check."
      />
      <QueryState
        query={query}
        errorFallback="Could not load alerts."
        loading={<SkeletonCard />}
      >
        {({ alerts, total, unread }) => (
          <section className="space-y-3" aria-label="Alerts">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {total} {total === 1 ? "alert" : "alerts"}, {unread} unread
              </p>
              {unread > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={markRead.isPending}
                  onClick={() => markRead.mutate("all")}
                >
                  Mark all read
                </Button>
              )}
            </div>
            {alerts.length === 0 ? (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                No alerts yet. They appear after two comparable collection days,
                or once a week with a summary.
              </p>
            ) : (
              <ul className="grid items-start gap-3 xl:grid-cols-2">
                {alerts.map((alert) => (
                  <AlertItem
                    key={alert.id}
                    alert={alert}
                    marking={markRead.isPending}
                    onMarkRead={() => markRead.mutate([alert.id])}
                  />
                ))}
              </ul>
            )}
            {total > PAGE_SIZE && (
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Newer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Older
                </Button>
              </div>
            )}
          </section>
        )}
      </QueryState>
    </div>
  );
}

function AlertItem({
  alert,
  marking,
  onMarkRead,
}: {
  alert: ProjectAlert;
  marking: boolean;
  onMarkRead: () => void;
}) {
  const unread = alert.readAt === null;
  const conditions = conditionsLine(alert.conditions);
  return (
    <li
      className={`space-y-2 rounded-xl border bg-card p-4 ${unread ? "border-primary/40" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">{alert.title}</h2>
            {unread && <Badge variant="soft">Unread</Badge>}
            <Badge variant="outline">{humanize(alert.kind)}</Badge>
            {!alert.comparable && (
              <Badge variant="warning">Not comparable</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatTime(alert.createdAt)}
          </p>
        </div>
        {unread && (
          <Button
            size="sm"
            variant="ghost"
            disabled={marking}
            onClick={onMarkRead}
          >
            Mark read
          </Button>
        )}
      </div>
      {conditions && (
        <p className="text-xs text-muted-foreground">{conditions}</p>
      )}
      <p className="whitespace-pre-line text-sm">{alert.body}</p>
    </li>
  );
}
