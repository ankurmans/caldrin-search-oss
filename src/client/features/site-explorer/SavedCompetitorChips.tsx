import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addExplorerCompetitors,
  getSavedCompetitors,
} from "@/serverFunctions/site-explorer";
import { gapKeys } from "./gap";

/**
 * The project's saved competitors as one-click targets, shown under a research
 * search box. The same list feeds the keyword gap and AI visibility. Reading
 * and saving cost nothing.
 */
export function SavedCompetitorChips({
  projectId,
  currentTarget,
  onPick,
}: {
  projectId: string;
  /** The domain being researched now, offered as "save as competitor". */
  currentTarget: string;
  onPick: (domain: string) => void;
}) {
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: gapKeys.competitors(projectId),
    queryFn: () => getSavedCompetitors({ data: { projectId } }),
  });
  const save = useMutation({
    mutationFn: (domain: string) =>
      addExplorerCompetitors({ data: { projectId, domains: [domain] } }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      toast.success("Saved as a competitor");
      void queryClient.invalidateQueries({
        queryKey: gapKeys.competitors(projectId),
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });

  const saved = listQuery.data ?? [];
  const target = currentTarget.trim().toLowerCase();
  const canSave =
    target.length > 0 &&
    !target.includes("/") &&
    !saved.some((competitor) => competitor.domain === target);

  if (listQuery.isLoading || (saved.length === 0 && !canSave)) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Saved competitors</span>
      {saved.map((competitor) => (
        <Button
          key={competitor.id}
          variant="outline"
          size="sm"
          onClick={() => onPick(competitor.domain)}
        >
          {competitor.domain}
        </Button>
      ))}
      {saved.length === 0 ? <Badge variant="soft">None yet</Badge> : null}
      {canSave ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate(target)}
        >
          <Plus data-icon="inline-start" /> Save {target}
        </Button>
      ) : null}
      <Button
        variant="link"
        size="sm"
        nativeButton={false}
        render={<Link to="/p/$projectId/competitors" params={{ projectId }} />}
      >
        Manage
      </Button>
    </div>
  );
}
