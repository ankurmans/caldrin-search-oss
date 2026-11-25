import { Button } from "@/client/components/ui/button";
import {
  PriorityBadge,
  SourceBadge,
  StaleBadge,
  StatusBadge,
} from "./OpportunityBadges";
import { ACTION_LABELS, type OpportunityRowData } from "./helpers";

export function OpportunityRow({
  opportunity,
  onOpen,
}: {
  opportunity: OpportunityRowData;
  onOpen: () => void;
}) {
  const subject = opportunity.pageUrl ?? opportunity.query;
  const dismissed = opportunity.status === "dismissed";
  return (
    <li
      className={`space-y-2 rounded-xl border bg-card p-3 md:p-4 ${dismissed ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-64 space-y-0.5">
          <p className="text-sm font-medium break-words">{opportunity.query}</p>
          {opportunity.pageUrl ? (
            <p className="text-xs break-all text-muted-foreground">{subject}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={opportunity.priority} />
          <SourceBadge source={opportunity.dataSource} />
          <StatusBadge status={opportunity.status} />
          {opportunity.noLongerFound ? <StaleBadge /> : null}
        </div>
      </div>
      <p className="text-sm">
        <span className="font-medium">
          {ACTION_LABELS[opportunity.recommendedAction]}
        </span>
        {opportunity.priorityReason ? (
          <span className="text-muted-foreground">
            {" "}
            · {opportunity.priorityReason}
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {opportunity.evidenceCount}{" "}
          {opportunity.evidenceCount === 1 ? "piece" : "pieces"} of evidence
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={onOpen}
          aria-label={`View details for ${opportunity.query}`}
        >
          View evidence
        </Button>
      </div>
    </li>
  );
}
