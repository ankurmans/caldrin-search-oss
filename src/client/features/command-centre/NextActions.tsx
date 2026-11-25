import { Link, linkOptions, type LinkOptions } from "@tanstack/react-router";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  ACTION_LABELS,
  SOURCE_LABELS,
  type ActionKey,
} from "@/client/features/opportunities/helpers";
import {
  PriorityBadge,
  SourceBadge,
} from "@/client/features/opportunities/OpportunityBadges";
import {
  effortFor,
  sampleStrength,
  type NextAction,
} from "@/client/features/command-centre/helpers";

const DRAFTABLE: ReadonlySet<ActionKey> = new Set([
  "new_article",
  "create_page",
  "refresh_existing_page",
  "update_collection_page",
  "improve_title_and_meta",
]);

function secondaryAction(projectId: string, action: NextAction) {
  const params = { projectId };
  if (action.dataSource === "ai_visibility") {
    return {
      label: "Review citation gap",
      options: linkOptions({
        to: "/p/$projectId/ai-visibility/citations",
        params,
      }),
    };
  }
  if (action.action === "technical_fix") {
    return {
      label: "Review in Site Audit",
      options: linkOptions({ to: "/p/$projectId/audit", params }),
    };
  }
  return {
    label: DRAFTABLE.has(action.action) ? "Create brief" : "Review action",
    options: linkOptions({
      to: "/p/$projectId/opportunities",
      params,
      search: { opportunity: action.id },
    }),
  };
}

function evidenceLine(action: NextAction) {
  const source = SOURCE_LABELS[action.dataSource];
  const parts = [source];
  if (action.observedAt) {
    parts.push(`observed ${formatRelativeTime(action.observedAt)}`);
  }
  if (action.dataSource === "gsc" || action.dataSource === "simulated") {
    parts.push(
      `${action.impressions.toLocaleString()} impressions, position ${action.position.toFixed(1)} (${action.windowStart} to ${action.windowEnd})`,
    );
  }
  parts.push(
    `${action.evidenceCount} ${action.evidenceCount === 1 ? "evidence row" : "evidence rows"}`,
  );
  return parts.join(" · ");
}

export function NextActions({
  projectId,
  actions,
  demoCount,
  open,
  lastObservedAt,
}: {
  projectId: string;
  actions: NextAction[];
  demoCount: number;
  open: number;
  lastObservedAt: string | null;
}) {
  return (
    <section aria-labelledby="next-actions-heading" className="min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <div>
          <h2 id="next-actions-heading" className="text-base font-semibold">
            Recommended Actions
          </h2>
          {lastObservedAt ? (
            <p className="text-xs text-muted-foreground">
              Analyzed {formatRelativeTime(lastObservedAt)}
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={
            <Link to="/p/$projectId/opportunities" params={{ projectId }} />
          }
        >
          {open > actions.length
            ? `All ${open} opportunities`
            : "Open Opportunities"}
        </Button>
      </header>
      {demoCount > 0 ? (
        <p className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          {demoCount} {demoCount === 1 ? "finding is" : "findings are"} from
          demo data, not your performance.
        </p>
      ) : null}
      <ul className="divide-y">
        {actions.map((action) => {
          const secondary = secondaryAction(projectId, action);
          return (
            <li key={action.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm font-medium">
                    {ACTION_LABELS[action.action]}
                  </p>
                  <p className="text-sm break-words text-muted-foreground">
                    {action.pageUrl ?? action.query}
                    {action.pageUrl && action.query
                      ? ` · “${action.query}”`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <PriorityBadge priority={action.priority} />
                  <SourceBadge source={action.dataSource} />
                </div>
              </div>
              <p className="text-sm">
                {action.priorityReason ?? action.reason}
              </p>
              <p className="text-xs text-muted-foreground">
                {evidenceLine(action)}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="outline">
                    Effort: {effortFor(action.action)}
                  </Badge>
                  {action.dataSource === "gsc" ? (
                    <Badge variant="outline">
                      Sample: {sampleStrength(action.impressions)}
                    </Badge>
                  ) : null}
                  <Badge variant="secondary">Open</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    nativeButton={false}
                    render={
                      <Link
                        to="/p/$projectId/opportunities"
                        params={{ projectId }}
                        search={{ opportunity: action.id }}
                      />
                    }
                  >
                    Open opportunity
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link {...secondary.options} />}
                  >
                    {secondary.label}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** No open opportunities: say which of three different reasons it is. */
export function NoNextActions({
  projectId,
  total,
  sourceConnected,
}: {
  projectId: string;
  total: number;
  /** Search Console or a store is connected, so an analysis has data to read. */
  sourceConnected: boolean;
}) {
  let title: string;
  let body: string;
  let cta: { label: string; options: LinkOptions };
  if (total > 0) {
    title = "Everything found so far is handled";
    body = "Run the analysis again to look for new opportunities.";
    cta = {
      label: "Review opportunities",
      options: linkOptions({
        to: "/p/$projectId/opportunities",
        params: { projectId },
      }),
    };
  } else if (sourceConnected) {
    title = "No opportunities yet";
    body = "Find opportunities from your search data, audit and AI answers.";
    cta = {
      label: "Find opportunities",
      options: linkOptions({
        to: "/p/$projectId/opportunities",
        params: { projectId },
      }),
    };
  } else {
    title = "Connect a data source";
    body = "Connect Search Console to find opportunities from your own data.";
    cta = {
      label: "Connect Search Console",
      options: linkOptions({
        to: "/p/$projectId/settings/integrations",
        params: { projectId },
        hash: "search-console",
      }),
    };
  }
  return (
    <section aria-labelledby="next-actions-heading" className="min-w-0 p-4">
      <h2 id="next-actions-heading" className="text-base font-semibold">
        Recommended Actions
      </h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
        <Button
          size="sm"
          nativeButton={false}
          render={<Link {...cta.options} />}
        >
          {cta.label}
        </Button>
      </div>
    </section>
  );
}
