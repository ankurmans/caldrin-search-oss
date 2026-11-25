import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAttributionSetupFn } from "@/serverFunctions/attribution";

export const attributionKey = (projectId: string, ...rest: unknown[]) =>
  ["attribution", projectId, ...rest] as const;

export function useAttributionSetup(projectId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: attributionKey(projectId, "setup"),
    queryFn: () => getAttributionSetupFn({ data: { projectId } }),
  });
  return {
    query,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: attributionKey(projectId) }),
  };
}
