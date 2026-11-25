import { Link } from "@tanstack/react-router";
import { Button } from "@/client/components/ui/button";
import { canDraft, type OpportunityRowData } from "./helpers";
import type { OpportunityActions } from "./useOpportunityActions";

export function OpportunityActionButtons({
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
  const { setStatus, draft } = actions;
  const busy = setStatus.isPending || draft.isPending;
  const writing = (generator: "llm" | "template") =>
    draft.isPending && draft.variables?.generator === generator;
  const changeStatus = (status: "open" | "briefed" | "dismissed") =>
    setStatus.mutate({ opportunityId: opportunity.id, status });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canDraft(opportunity.recommendedAction) ? (
        <>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              draft.mutate({ opportunityId: opportunity.id, generator: "llm" })
            }
          >
            {writing("llm") ? "Writing…" : "Create draft in Content Studio"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              draft.mutate({
                opportunityId: opportunity.id,
                generator: "template",
              })
            }
          >
            {writing("template") ? "Creating…" : "Outline only"}
          </Button>
        </>
      ) : null}
      {drafted ? (
        <Button
          size="sm"
          variant="link"
          nativeButton={false}
          render={<Link to="/p/$projectId/content" params={{ projectId }} />}
        >
          Open Content Studio
        </Button>
      ) : null}
      {opportunity.status === "open" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => changeStatus("briefed")}
        >
          Mark in progress
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => changeStatus("open")}
        >
          Reopen
        </Button>
      )}
      {opportunity.status === "dismissed" ? null : (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => changeStatus("dismissed")}
        >
          Dismiss
        </Button>
      )}
    </div>
  );
}
