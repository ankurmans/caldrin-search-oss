import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { QueryState } from "@/client/components/QueryState";
import { getSearchOpportunity } from "@/serverFunctions/opportunities";
import { EvidenceList } from "./EvidenceList";
import { OpportunityActionButtons } from "./OpportunityActionButtons";
import {
  PriorityBadge,
  SourceBadge,
  StaleBadge,
  StatusBadge,
} from "./OpportunityBadges";
import { SearchMetrics } from "./SearchMetrics";
import {
  ACTION_LABELS,
  intentLabel,
  opportunityDetailKey,
  type OpportunityRowData,
} from "./helpers";
import type { OpportunityActions } from "./useOpportunityActions";

export function OpportunityDetailSheet({
  projectId,
  opportunity,
  actions,
  drafted,
  onClose,
}: {
  projectId: string;
  opportunity: OpportunityRowData | null;
  actions: OpportunityActions;
  drafted: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={opportunity !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        {opportunity ? (
          <DetailBody
            projectId={projectId}
            opportunity={opportunity}
            actions={actions}
            drafted={drafted}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  projectId,
  opportunity,
  actions,
  drafted,
}: {
  projectId: string;
  opportunity: OpportunityRowData;
  actions: OpportunityActions;
  drafted: boolean;
}) {
  const detail = useQuery({
    queryKey: opportunityDetailKey(projectId, opportunity.id),
    queryFn: () =>
      getSearchOpportunity({
        data: { projectId, opportunityId: opportunity.id },
      }),
  });
  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle className="break-words">{opportunity.query}</SheetTitle>
        <SheetDescription className="break-all">
          {opportunity.pageUrl ?? "No specific page"}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={opportunity.priority} />
          <SourceBadge source={opportunity.dataSource} />
          <StatusBadge status={opportunity.status} />
          {opportunity.noLongerFound ? <StaleBadge /> : null}
          {opportunity.intent ? (
            <span className="text-xs text-muted-foreground">
              {intentLabel(opportunity.intent)} intent
            </span>
          ) : null}
        </div>
        <section className="space-y-1">
          <h3 className="text-sm font-medium">
            {ACTION_LABELS[opportunity.recommendedAction]}
          </h3>
          <p className="text-sm text-muted-foreground">{opportunity.reason}</p>
          {opportunity.priorityReason ? (
            <p className="text-sm text-muted-foreground">
              Priority: {opportunity.priorityReason}
            </p>
          ) : null}
          {opportunity.dataSource === "simulated" ? (
            <p className="text-xs text-muted-foreground">
              This recommendation comes from demo data, not from your real
              search traffic.
            </p>
          ) : null}
        </section>
        <SearchMetrics opportunity={opportunity} />
        <OpportunityActionButtons
          projectId={projectId}
          opportunity={opportunity}
          actions={actions}
          drafted={drafted}
        />
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Evidence</h3>
          <QueryState
            query={detail}
            errorFallback="Could not load the evidence."
          >
            {(data) => <EvidenceList evidence={data.evidence} />}
          </QueryState>
        </section>
      </div>
    </>
  );
}
