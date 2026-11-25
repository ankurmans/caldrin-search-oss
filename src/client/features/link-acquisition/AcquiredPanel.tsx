import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { formatCompactDate } from "@/client/features/backlinks/backlinksPageUtils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createLinkPlacement,
  getLinkPlacements,
  verifyLinkPlacement,
} from "@/serverFunctions/link-acquisition";
import { LINK_CAMPAIGN_MODE_LABELS } from "@/shared/link-acquisition";
import { prospectKeys, type PlacementRow } from "./prospects";

const STATE_LABEL: Record<PlacementRow["state"], string> = {
  promised: "Promised, not yet seen",
  observed: "Seen, not yet checked",
  confirmed_live: "Confirmed live",
  later_removed: "Removed later",
  no_longer_verifiable: "No longer verifiable",
};
const STATE_VARIANT: Record<
  PlacementRow["state"],
  "outline" | "success" | "destructive" | "warning"
> = {
  promised: "outline",
  observed: "outline",
  confirmed_live: "success",
  later_removed: "destructive",
  no_longer_verifiable: "warning",
};
const OUTCOME_LABEL: Record<string, string> = {
  confirmed: "Link found",
  attributes_changed: "Link found, attributes changed",
  link_missing: "No link to the page",
  destination_changed: "Link goes somewhere else",
  page_gone: "Page not found",
  unverifiable: "Could not be checked",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Placement({
  projectId,
  placement,
}: {
  projectId: string;
  placement: PlacementRow;
}) {
  const queryClient = useQueryClient();
  const verify = useMutation({
    mutationFn: () =>
      verifyLinkPlacement({
        data: { projectId, input: { placementId: placement.id } },
      }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      const label = OUTCOME_LABEL[result.data.outcome] ?? "Checked";
      if (result.data.state === "confirmed_live") toast.success(label);
      else toast.message(label);
      void queryClient.invalidateQueries({
        queryKey: prospectKeys.placements(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: prospectKeys.all(projectId),
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });
  const latest = placement.checks[0];
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATE_VARIANT[placement.state]}>
          {STATE_LABEL[placement.state]}
        </Badge>
        <Badge variant="outline">
          {LINK_CAMPAIGN_MODE_LABELS[placement.campaignMode]}
        </Badge>
        {placement.costUsd !== null ? (
          <span className="text-xs text-muted-foreground">
            Cost ${placement.costUsd.toFixed(2)}
          </span>
        ) : null}
        <Button
          className="ml-auto"
          variant="outline"
          size="sm"
          disabled={verify.isPending}
          onClick={() => verify.mutate()}
        >
          Check now
        </Button>
      </div>
      <p className="text-sm break-all">
        <SafeExternalLink
          url={placement.urlFrom}
          label={placement.urlFrom}
          className="font-medium underline-offset-4 hover:underline"
        />{" "}
        <span className="text-muted-foreground">should link to</span>{" "}
        {placement.expectedTarget}
      </p>
      <p className="text-xs text-muted-foreground">
        First confirmed {formatCompactDate(placement.firstVerifiedAt)}; last
        checked {formatCompactDate(placement.lastCheckedAt)}.
      </p>
      {latest ? (
        <div className="rounded-lg border bg-muted/30 p-2.5 text-xs">
          <p className="font-medium">
            Last check: {OUTCOME_LABEL[latest.outcome] ?? latest.outcome}
            {latest.httpStatus ? ` (HTTP ${latest.httpStatus})` : ""}
          </p>
          {latest.foundHref ? (
            <p className="break-all">
              Link found: {latest.foundHref}
              {latest.anchor ? `, anchor “${latest.anchor}”` : ""} ·{" "}
              {[
                latest.isNofollow ? "nofollow" : "follow",
                latest.isSponsored ? "sponsored" : null,
                latest.isUgc ? "ugc" : null,
              ]
                .filter(Boolean)
                .join(", ")}
            </p>
          ) : null}
          {latest.context ? (
            <p className="text-muted-foreground">…{latest.context}…</p>
          ) : null}
          {latest.note ? <p>{latest.note}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

export function AcquiredPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [urlFrom, setUrlFrom] = useState("");
  const [target, setTarget] = useState("");
  const [sponsored, setSponsored] = useState(false);
  const query = useQuery({
    queryKey: prospectKeys.placements(projectId),
    queryFn: () => getLinkPlacements({ data: { projectId } }),
  });
  const add = useMutation({
    mutationFn: () =>
      createLinkPlacement({
        data: {
          projectId,
          input: {
            urlFrom,
            expectedTarget: target,
            campaignMode: sponsored
              ? "sponsored_distribution"
              : "earned_editorial",
            state: "promised",
          },
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      setUrlFrom("");
      setTarget("");
      void queryClient.invalidateQueries({
        queryKey: prospectKeys.placements(projectId),
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });

  if (query.isError) {
    return (
      <QueryError
        error={query.error}
        fallback="Failed to load acquired links"
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const report = query.data?.report;
  const placements = query.data?.placements ?? [];

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        A link counts as live only when a check finds a real hyperlink to the
        page on your site. Links are re-checked daily, so a removed or changed
        link shows up here. A rise in the backlink count is not proof of a
        placement.
      </p>

      {report ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="Prospects" value={report.prospects} />
          <Stat label="Qualified" value={report.qualified} />
          <Stat label="Outreach approved" value={report.outreachApproved} />
          <Stat label="Marked sent" value={report.sent} />
          <Stat label="Replies logged" value={report.responses} />
          <Stat label="Confirmed live" value={report.confirmedLive} />
          <Stat
            label="Verified referring domains"
            value={report.verifiedReferringDomains}
          />
          <Stat label="Earned live" value={report.earnedLive} />
          <Stat label="Sponsored live" value={report.sponsoredLive} />
          <Stat label="Removed later" value={report.laterRemoved} />
          <Stat
            label="No longer verifiable"
            value={report.noLongerVerifiable}
          />
          <Stat
            label="Recorded cost"
            value={`$${report.recordedCostUsd.toFixed(2)}`}
          />
        </div>
      ) : null}
      {report ? (
        <p className="text-xs text-muted-foreground">{report.note}</p>
      ) : null}

      <Card className="space-y-2 p-4">
        <h3 className="text-sm font-semibold">Record a link</h3>
        <p className="text-xs text-muted-foreground">
          Add a page that has linked to you, or that has promised to. The first
          check confirms it.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={urlFrom}
            onChange={(event) => setUrlFrom(event.target.value)}
            placeholder="Page that links to you"
            aria-label="Linking page"
          />
          <Input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="Page on your site it links to"
            aria-label="Target page"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sponsored}
            onChange={(event) => setSponsored(event.target.checked)}
          />
          Paid or sponsored placement
        </label>
        <Button
          size="sm"
          disabled={!urlFrom.trim() || !target.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          Add
        </Button>
      </Card>

      {query.isLoading ? null : placements.length === 0 ? (
        <EmptyState
          kind="no-data"
          title="No links recorded yet"
          description="Record a link above, or acquire one from a prospect."
        />
      ) : (
        <div className="space-y-3">
          {placements.map((placement) => (
            <Placement
              key={placement.id}
              projectId={projectId}
              placement={placement}
            />
          ))}
        </div>
      )}
    </div>
  );
}
