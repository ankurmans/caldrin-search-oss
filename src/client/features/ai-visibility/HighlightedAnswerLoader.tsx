import { queryOptions, useQuery } from "@tanstack/react-query";
import { getAiVisibilityAnswer } from "@/serverFunctions/ai-visibility";
import { HighlightedAnswer } from "./HighlightedAnswer";
import { AiLoading, AiQueryError, aiVisibilityKey } from "./shared";

export const aiAnswerQueryOptions = (
  projectId: string,
  observationId: string,
) =>
  queryOptions({
    queryKey: [...aiVisibilityKey(projectId), "answer", observationId],
    queryFn: () =>
      getAiVisibilityAnswer({ data: { projectId, observationId } }),
    staleTime: 0,
  });

/** Reads one saved answer and shows it with its evidence highlighted. */
export function HighlightedAnswerById({
  projectId,
  observationId,
}: {
  projectId: string;
  observationId: string;
}) {
  const query = useQuery(aiAnswerQueryOptions(projectId, observationId));
  if (query.isPending) return <AiLoading />;
  if (query.isError)
    return (
      <AiQueryError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return <HighlightedAnswer answer={query.data} />;
}
