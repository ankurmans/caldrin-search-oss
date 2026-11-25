import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createContentDraft } from "@/serverFunctions/content";
import { setSearchOpportunityStatus } from "@/serverFunctions/opportunities";
import { plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { opportunitiesKey, type StatusKey } from "./helpers";

export type DraftGenerator = "template" | "llm";

export function useOpportunityActions(
  projectId: string,
  onDrafted: (opportunityId: string) => void,
) {
  const queryClient = useQueryClient();
  const { showCosts } = useCostDisplay();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: opportunitiesKey(projectId) });

  const setStatus = useMutation({
    mutationFn: (input: { opportunityId: string; status: StatusKey }) =>
      setSearchOpportunityStatus({ data: { projectId, ...input } }),
    onSuccess: (result) => {
      if (result.ok) void refresh();
      else toast.error(plainReason(result.reason, showCosts));
    },
  });

  const draft = useMutation({
    mutationFn: (input: { opportunityId: string; generator: DraftGenerator }) =>
      createContentDraft({ data: { projectId, ...input } }),
    onSuccess: (result, input) => {
      if (!result.ok) {
        toast.error(plainReason(result.reason, showCosts));
        return;
      }
      toast.success("Draft created in Content Studio.");
      onDrafted(input.opportunityId);
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ["content", projectId] });
    },
  });

  return { setStatus, draft };
}

export type OpportunityActions = ReturnType<typeof useOpportunityActions>;
