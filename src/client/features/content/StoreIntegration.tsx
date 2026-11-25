import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryState } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { getContentOverview } from "@/serverFunctions/content";
import { ConnectionCard } from "./ConnectionCard";
import { contentKey } from "./helpers";
import { storePlatformKey } from "./ShopifyPlatformGate";

/** The store connection, as an integration rather than the Content Studio's first screen. */
export function StoreIntegration({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: contentKey(projectId),
    queryFn: () => getContentOverview({ data: { projectId } }),
  });
  return (
    <QueryState
      query={query}
      errorFallback="Could not load the store connection."
      loading={<SkeletonCard />}
    >
      {({ connection, shopifyOAuthConfigured }) => (
        <ConnectionCard
          projectId={projectId}
          connection={connection}
          oauthConfigured={shopifyOAuthConfigured}
          onChange={() => {
            void queryClient.invalidateQueries({
              queryKey: contentKey(projectId),
            });
            // Connecting or disconnecting changes whether the cards show.
            void queryClient.invalidateQueries({
              queryKey: storePlatformKey(projectId),
            });
          }}
        />
      )}
    </QueryState>
  );
}
