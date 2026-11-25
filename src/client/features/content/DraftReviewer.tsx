import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getDraftReviewers,
  setDraftReviewer,
} from "@/serverFunctions/contentEditorial";

export function DraftReviewer({
  projectId,
  assetId,
  reviewer,
  onChange,
}: {
  projectId: string;
  assetId: string;
  reviewer: string | null;
  onChange: () => void;
}) {
  const choices = useQuery({
    queryKey: ["draft-reviewers", projectId],
    queryFn: () => getDraftReviewers({ data: { projectId } }),
  });
  const assign = useMutation({
    mutationFn: async (id: string | null) => {
      const result = await setDraftReviewer({
        data: { projectId, assetId, reviewer: id },
      });
      if (!result.ok) throw new Error(result.reason);
      return result.data.reviewer;
    },
    onSuccess: onChange,
  });
  if (choices.isError)
    return (
      <p className="text-xs text-muted-foreground">Could not load reviewers.</p>
    );
  if (!choices.data?.length) return null;
  const selected = assign.isSuccess ? assign.data : reviewer;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="inline-flex items-center gap-2">
        Reviewer
        <select
          className="rounded-md border bg-background px-2 py-1"
          disabled={assign.isPending}
          value={selected ?? ""}
          onChange={(event) => assign.mutate(event.target.value || null)}
        >
          <option value="">Unassigned</option>
          {selected && !choices.data.some((user) => user.id === selected) ? (
            <option value={selected}>Previous reviewer</option>
          ) : null}
          {choices.data.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name || "Unnamed teammate"}
            </option>
          ))}
        </select>
      </label>
      {assign.isError ? (
        <span role="alert" className="text-destructive">
          {assign.error.message}
        </span>
      ) : null}
    </div>
  );
}
