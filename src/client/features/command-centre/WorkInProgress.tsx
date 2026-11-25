import { Link, linkOptions } from "@tanstack/react-router";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { STATUS_LABELS } from "@/client/features/ledger/helpers";
import type { CommandCentreData } from "@/client/features/command-centre/helpers";

export function WorkInProgress({
  projectId,
  data,
}: {
  projectId: string;
  data: CommandCentreData;
}) {
  const { execution, opportunities, ai } = data;
  const params = { projectId };
  const rows = execution
    ? [
        {
          label: "Changes awaiting approval",
          count: execution.pendingApprovals,
          options: linkOptions({ to: "/p/$projectId/changes", params }),
        },
        {
          label: "Content drafts",
          count: execution.draftAssets,
          options: linkOptions({ to: "/p/$projectId/content", params }),
        },
        {
          label: "Approved, not yet published",
          count: execution.approvedNotRun + execution.approvedAssets,
          options: linkOptions({ to: "/p/$projectId/changes", params }),
        },
        {
          label: "Opportunities in progress",
          count: opportunities?.inProgress ?? 0,
          options: linkOptions({ to: "/p/$projectId/opportunities", params }),
        },
        {
          label: "Follow-up checks due",
          count: execution.followUpsDue,
          options: linkOptions({ to: "/p/$projectId/changes", params }),
        },
        {
          label: "Failed changes",
          count: execution.failed,
          options: linkOptions({ to: "/p/$projectId/changes", params }),
        },
        {
          label: "Unread alerts",
          count: execution.unreadAlerts,
          options: linkOptions({ to: "/p/$projectId/alerts", params }),
        },
      ].filter((row) => row.count > 0)
    : [];

  return (
    <section
      aria-labelledby="wip-heading"
      className="flex min-w-0 flex-col gap-3 p-4"
    >
      <h2 id="wip-heading" className="text-base font-semibold">
        Work in Progress
      </h2>
      {execution === null ? (
        <p className="text-sm text-muted-foreground">
          Work history could not be read just now.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((row) => (
            <li key={row.label}>
              <Link
                {...row.options}
                className="flex items-center justify-between gap-2 py-2 hover:text-foreground"
              >
                <span>{row.label}</span>
                <span className="font-semibold tabular-nums">{row.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {ai?.configured && ai.nextCheckAt ? (
        <p className="text-xs text-muted-foreground">
          Next scheduled AI check {formatRelativeTime(ai.nextCheckAt)}.
        </p>
      ) : null}
      {execution && execution.recent.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground">
            Recently
          </h3>
          <ul className="space-y-1 text-xs">
            {execution.recent.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-2">
                <span className="truncate">{entry.proposedAction}</span>
                <span className="shrink-0 text-muted-foreground">
                  {STATUS_LABELS[entry.status] ?? entry.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
