import { Link, linkOptions } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  type DataStatus as DataStatusModel,
  type SourceStatus,
} from "./dataSources";

const STATE_LABEL: Record<SourceStatus["state"], string> = {
  ok: "Up to date",
  stale: "Stale",
  missing: "Missing",
  failed: "Failed",
};

function actionOptions(
  projectId: string,
  action: NonNullable<SourceStatus["action"]>,
) {
  const params = { projectId };
  switch (action) {
    case "connect_gsc":
      return {
        label: "Connect Search Console",
        options: linkOptions({
          to: "/p/$projectId/settings/integrations",
          params,
          hash: "search-console",
        }),
      };
    case "set_up_ai":
      return {
        label: "Set up AI visibility",
        options: linkOptions({
          to: "/p/$projectId/ai-visibility/research",
          params,
        }),
      };
    case "set_up_rank":
      return {
        label: "Set up rank tracking",
        options: linkOptions({ to: "/p/$projectId/rank-tracking", params }),
      };
    case "run_analysis":
      return {
        label: "Find opportunities",
        options: linkOptions({ to: "/p/$projectId/opportunities", params }),
      };
    case "run_audit":
      return {
        label: "Open Site Audit",
        options: linkOptions({ to: "/p/$projectId/audit", params }),
      };
  }
}

/**
 * The one place the dashboard says how fresh its sources are, what has gone
 * wrong and what to do about it, so the header carries a single control
 * instead of a pill per source.
 */
export function DataStatus({
  projectId,
  status,
}: {
  projectId: string;
  status: DataStatusModel;
}) {
  const attention = status.needsAttention;
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" />}
        aria-label="Data status"
      >
        {attention > 0 ? (
          <AlertTriangle className="text-amber-600 dark:text-amber-400" />
        ) : (
          <CheckCircle2 className="text-green-700 dark:text-success" />
        )}
        Data status
        {attention > 0 ? (
          <span className="text-muted-foreground">· {attention} to review</span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw-2rem))] border border-border shadow-lg ring-0"
      >
        <ul className="divide-y divide-border text-sm">
          {status.sources.map((source) => {
            const action = source.action
              ? actionOptions(projectId, source.action)
              : null;
            return (
              <li
                key={source.id}
                className="space-y-1 py-2 first:pt-0 last:pb-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{source.label}</span>
                  <span
                    className={
                      source.state === "ok"
                        ? "text-xs text-muted-foreground"
                        : "text-xs font-medium text-amber-700 dark:text-amber-300"
                    }
                  >
                    {STATE_LABEL[source.state]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {source.detail}
                  {source.at
                    ? ` Last updated ${formatRelativeTime(source.at)}.`
                    : ""}
                </p>
                {action ? (
                  <Button
                    size="xs"
                    variant="outline"
                    nativeButton={false}
                    render={<Link {...action.options} />}
                  >
                    {action.label}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
